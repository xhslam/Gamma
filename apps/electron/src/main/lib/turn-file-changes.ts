import type { BigIntStats } from 'node:fs'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import { parseDiffFromFile } from '@pierre/diffs'
import type { TurnFileChangeSummary, TurnFileChangesResult } from '@carpus/shared'
import { resolvePathAgainstAgentCwd } from './agent-file-path'
import { writeTextFileAtomic } from './safe-file'

const MAX_FILE_BYTES = 128 * 1024
const MAX_RECORDS = 192
const MAX_BYTES = 16 * 1024 * 1024

interface Snapshot { content: string; version: string; mode: number }
export interface TurnFileEdit {
  toolId: string
  path: string
  before: Snapshot | null
  after: Snapshot
}

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined
}

function version(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

/** null 表示文件不存在；undefined 表示无法安全读取，不能当作新文件。 */
function snapshot(path: string): Snapshot | null | undefined {
  try {
    // 文件和祖先目录都不应经由符号链接解析；新建嵌套文件时检查最近存在的祖先。
    let parent = dirname(path)
    for (;;) {
      try {
        if (realpathSync.native(parent) !== parent) return undefined
        break
      } catch (error) {
        if (errorCode(error) !== 'ENOENT' || lstatIfExists(parent) || dirname(parent) === parent) return undefined
        parent = dirname(parent)
      }
    }
    const entry = lstatIfExists(path)
    if (!entry) return null
    if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_FILE_BYTES) return undefined
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const stat = fstatSync(fd, { bigint: true })
      if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(MAX_FILE_BYTES)) return undefined
      const bytes = Buffer.alloc(Number(stat.size) + 1)
      let length = 0
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, null)
        if (!count) break
        length += count
      }
      const key = version(stat)
      if (length !== Number(stat.size) || version(lstatSync(path, { bigint: true })) !== key) return undefined
      const content = bytes.subarray(0, length).toString('utf8')
      if (content.includes('\0') || !Buffer.from(content).equals(bytes.subarray(0, length))) return undefined
      return { content, version: key, mode: Number(stat.mode) & 0o777 }
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

function lstatIfExists(path: string) {
  try { return lstatSync(path) } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

export async function captureTurnFileEdit<T>(
  cwd: string, toolId: string, rawPath: unknown,
  execute: () => Promise<T>, record: (edit: TurnFileEdit) => void | Promise<void>,
): Promise<T> {
  if (typeof rawPath !== 'string' || !rawPath) return execute()
  // 不猜测 SDK 对特殊拼写的路径转换，无法确认的路径仅在 UI 展示工具记录。
  if (/^(@|file:\/\/)|[\u00A0\u2000-\u200A\u202F\u205F\u3000]/.test(rawPath)
    || (process.platform === 'win32' && rawPath.startsWith('/'))
    || (process.platform !== 'win32' && rawPath.startsWith('~\\'))) return execute()
  const originalPath = resolvePathAgainstAgentCwd(rawPath, cwd)
  const local = relative(cwd, originalPath)
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)
    || local.split(sep).some(part => part.toLowerCase() === '.git')) return execute()
  let path: string
  try { path = resolvePathAgainstAgentCwd(local, realpathSync.native(cwd)) } catch { return execute() }
  const before = snapshot(path)
  const result = await execute()
  if (before !== undefined) {
    const after = snapshot(path)
    if (after) {
      // 跟踪失败不能改变已成功执行的工具结果。
      try { await record({ toolId, path, before, after }) } catch { /* 不记录文件内容到日志 */ }
    }
  }
  return result
}

interface FileEdits extends TurnFileEdit { continuous: boolean; undone?: boolean }

export class TurnFileChangeStore {
  private records = new Map<string, TurnFileEdit & { undone?: boolean }>()
  private bytes = 0

  record(sessionId: string, edit: TurnFileEdit) {
    const key = `${sessionId}\0${edit.toolId}`
    if (this.records.has(key)) return
    this.records.set(key, edit)
    this.bytes += this.size(edit)
    while (this.records.size > MAX_RECORDS || this.bytes > MAX_BYTES) {
      const oldest = this.records.keys().next().value!
      this.bytes -= this.size(this.records.get(oldest)!)
      this.records.delete(oldest)
    }
  }

  private size(edit: TurnFileEdit) {
    return ((edit.before?.content.length ?? 0) + edit.after.content.length) * 2
  }

  select(sessionId: string, ids: string[]) {
    const coveredToolIds: string[] = []
    const files = new Map<string, FileEdits>()
    const selected = new Set(ids.map(id => `${sessionId}\0${id}`))
    // 以实际执行顺序为准，而不是渲染器提供的顺序。
    for (const [key, edit] of this.records) {
      if (!selected.has(key)) continue
      coveredToolIds.push(edit.toolId)
      const prev = files.get(edit.path)
      files.set(edit.path, prev ? {
        ...prev, after: edit.after,
        continuous: prev.continuous && prev.after.version === edit.before?.version,
        undone: prev.undone && edit.undone,
      } : { ...edit, continuous: true })
    }
    return { coveredToolIds, files: [...files.values()] }
  }

  summarize(sessionId: string, ids: string[], allowed: ReadonlySet<string>): TurnFileChangesResult {
    const selected = this.select(sessionId, ids)
    const files: TurnFileChangeSummary[] = []
    for (const edit of selected.files) {
      if (!allowed.has(edit.path) || (edit.continuous && !hasChange(edit))) continue
      let stats: Pick<TurnFileChangeSummary, 'additions' | 'deletions'> = {}
      if (edit.continuous) {
        const diff = { oldContent: edit.before?.content ?? '', newContent: edit.after.content }
        try {
          if (diff.oldContent === diff.newContent) stats = { additions: 0, deletions: 0 }
          else {
            // 限制同步行差异计算；大文件仍可查看或撤销。
            if ((diff.oldContent.match(/\n/g)?.length ?? 0) + (diff.newContent.match(/\n/g)?.length ?? 0) > 2_000) throw new Error('diff too large')
            const parsed = parseDiffFromFile({ name: 'file', contents: diff.oldContent }, { name: 'file', contents: diff.newContent })
            stats = {
              additions: parsed.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
              deletions: parsed.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
            }
          }
        } catch { /* 无法快速计算时，不显示估算数值 */ }
      }
      files.push({ path: edit.path, created: edit.continuous && !edit.before, ...stats })
    }
    const coveredToolIds = selected.coveredToolIds.filter(id => allowed.has(this.records.get(`${sessionId}\0${id}`)!.path))
    const undone = files.length > 0 && selected.files.filter(hasChange).every(file => file.undone)
    return { files, coveredToolIds, undone, canUndo: !undone && files.length > 0 && this.isComplete(selected, ids, allowed) }
  }

  private isComplete(selected: ReturnType<TurnFileChangeStore['select']>, ids: string[], allowed: ReadonlySet<string>) {
    return selected.coveredToolIds.length === new Set(ids).size
      && selected.files.every(file => file.continuous && allowed.has(file.path) && !file.undone)
  }

  undo(sessionId: string, ids: string[], allowed: ReadonlySet<string>): string[] {
    const selected = this.select(sessionId, ids)
    const changed = selected.files.filter(hasChange)
    if (!changed.length || !this.isComplete(selected, ids, allowed)) throw new Error('本轮快照不完整或已撤销。')
    const matches = (edit: TurnFileEdit) => snapshot(edit.path)?.version === edit.after.version
    const conflict = changed.find(edit => !matches(edit))
    if (conflict) throw new Error(`文件在本轮结束后又被修改，未执行撤销：${conflict.path}`)
    const restored: string[] = []
    for (const edit of changed) {
      try {
        if (!matches(edit)) throw new Error('文件已变化')
        if (edit.before) writeTextFileAtomic(edit.path, edit.before.content, edit.before.mode)
        else unlinkSync(edit.path)
        restored.push(edit.path)
        for (const id of ids) {
          const record = this.records.get(`${sessionId}\0${id}`)
          if (record?.path === edit.path) record.undone = true
        }
      } catch {
        throw new Error(`${restored.length ? `已撤销 ${restored.length} 个文件；` : ''}无法撤销：${edit.path}`)
      }
    }
    return restored
  }
}

function hasChange(edit: TurnFileEdit): boolean {
  return !edit.before || edit.before.content !== edit.after.content || edit.before.mode !== edit.after.mode
}

export const turnFileChangeStore = new TurnFileChangeStore()
