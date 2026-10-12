import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { MarkdownWorkspaceDocument, MarkdownWorkspaceResult, MarkdownWorkspaceSource } from '@gamma/shared'
import { readJsonFileSafe, writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'
import { getMarkdownWorkspaceConfigPath } from './config-paths'
import { isMarkdownFilename, isSafeMarkdownPath, isWithinMarkdownRoot, MARKDOWN_FILE_LIMIT, MARKDOWN_RICH_LIMIT } from './markdown-workspace-policy'

interface SourceGrant extends MarkdownWorkspaceSource { owner: string; root: string; rootIdentity: string; origin: 'dialog' | 'project' | 'persisted' }
interface Snapshot {
  sourceId: string; owner: string; realPath: string; bom: boolean; crlf: boolean; lineEndings: string; mode: number
  document: MarkdownWorkspaceDocument
}
interface PersistedWorkspacesData {
  workspaces?: Record<string, string[]>
}
class MarkdownPolicyError extends Error {}
class MarkdownSnapshotChanged extends Error {}
class MarkdownTooLarge extends Error {}
/** 从已校验 inode 的 descriptor 有界读取；读取期间变化时拒绝产生半份快照。 */
function readSnapshotBytes(path: string, expected: Stats): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size || before.mtimeMs !== expected.mtimeMs || before.mode !== expected.mode) throw new MarkdownSnapshotChanged()
    if (before.size > MARKDOWN_FILE_LIMIT) throw new MarkdownTooLarge()
    const buffer = Buffer.allocUnsafe(Math.min(before.size + 1, MARKDOWN_FILE_LIMIT + 1))
    let offset = 0
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    const after = fstatSync(descriptor)
    if (offset > MARKDOWN_FILE_LIMIT || after.size > MARKDOWN_FILE_LIMIT) throw new MarkdownTooLarge()
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.mode !== before.mode) throw new MarkdownSnapshotChanged()
    return buffer.subarray(0, offset)
  } finally { closeSync(descriptor) }
}
function failure(error: unknown): MarkdownWorkspaceResult {
  if (error instanceof MarkdownSnapshotChanged) return { status: 'error', code: 'conflict', message: '读取期间文件发生变化，请重试。草稿未覆盖。' }
  if (error instanceof MarkdownTooLarge) return { status: 'error', code: 'too-large', message: '文件超过 5 MiB，未读取或覆盖。' }
  if (error instanceof MarkdownPolicyError) return { status: 'error', code: 'denied', message: error.message }
  const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
  return { status: 'error', code: missing ? 'missing' : 'io', message: missing ? '文件已移动或删除。草稿仍保留。' : '文件操作失败。请检查权限、磁盘空间和文件状态。' }
}

/** 主进程专用。所有方法同步，因此应用内的保存请求不会在 revision 检查与替换间交错。
 * 不承诺与任意外部进程共享锁的绝对 CAS；每次保存前都会重新核验磁盘快照。
 */
export class MarkdownWorkspaceService {
  private sources = new Map<string, SourceGrant>()
  private documents = new Map<string, Snapshot>()
  constructor(
    private atomicWrite = writeTextFileAtomic,
    private configPathGetter: () => string = getMarkdownWorkspaceConfigPath,
  ) {}

  private loadPersistedPaths(scopeKey: string): string[] {
    try {
      const configPath = this.configPathGetter()
      const data = readJsonFileSafe<PersistedWorkspacesData>(configPath)
      return Array.isArray(data?.workspaces?.[scopeKey]) ? data.workspaces[scopeKey] : []
    } catch { return [] }
  }

  private savePersistedPath(scopeKey: string, dirPath: string): void {
    try {
      const configPath = this.configPathGetter()
      const parent = dirname(configPath)
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
      const data = readJsonFileSafe<PersistedWorkspacesData>(configPath) ?? {}
      const current = Array.isArray(data.workspaces?.[scopeKey]) ? data.workspaces[scopeKey] : []
      if (!current.includes(dirPath)) {
        writeJsonFileAtomic(configPath, { ...data, workspaces: { ...(data.workspaces ?? {}), [scopeKey]: [...current, dirPath] } })
      }
    } catch { /* 忽略写入错误 */ }
  }

  private removePersistedPath(scopeKey: string, dirPath: string): void {
    try {
      const configPath = this.configPathGetter()
      const data = readJsonFileSafe<PersistedWorkspacesData>(configPath) ?? {}
      const current = Array.isArray(data.workspaces?.[scopeKey]) ? data.workspaces[scopeKey] : []
      if (current.includes(dirPath)) {
        writeJsonFileAtomic(configPath, { ...data, workspaces: { ...(data.workspaces ?? {}), [scopeKey]: current.filter(p => p !== dirPath) } })
      }
    } catch { /* 忽略写入错误 */ }
  }

  /** 仅由主进程原生 dialog 或已核验项目根调用，不能直接暴露为 IPC。 */
  grant(owner: string, path: string, kind: 'file' | 'directory', origin: 'dialog' | 'project' | 'persisted' = 'dialog', scopeKey?: string): MarkdownWorkspaceSource {
    const root = realpathSync(path)
    const stat = statSync(root)
    if ((kind === 'directory' && !stat.isDirectory()) || (kind === 'file' && (!stat.isFile() || !isMarkdownFilename(root)))) throw new MarkdownPolicyError('请选择 Markdown 文件或目录。')
    const existing = [...this.sources.values()].find(item => item.owner === owner && item.root === root && item.kind === kind && (item.origin === origin || origin === 'persisted') && (kind === 'file' || item.rootIdentity === `${stat.dev}:${stat.ino}`))
    if (existing) {
      if (kind === 'directory' && scopeKey && origin !== 'project') this.savePersistedPath(scopeKey, root)
      return { id: existing.id, name: existing.name, kind }
    }
    const source: SourceGrant = { id: randomUUID(), name: basename(root), kind, root, owner, rootIdentity: `${stat.dev}:${stat.ino}`, origin }
    this.sources.set(source.id, source)
    if (kind === 'directory' && scopeKey && origin !== 'project') {
      this.savePersistedPath(scopeKey, root)
    }
    return { id: source.id, name: source.name, kind }
  }
  /** 项目重绑定或删除后，旧项目根来源立即失效；原生 dialog 的独立授权不受影响。 */
  synchronizeProject(owner: string, path?: string): void {
    let current: string | undefined
    try { current = path ? realpathSync(path) : undefined } catch { /* 不可用的项目不能维持旧授权 */ }
    for (const source of this.sources.values()) {
      if (source.owner === owner && source.origin === 'project' && source.root !== current) this.release(owner, source.id)
    }
  }
  release(owner: string, id: string, scopeKey?: string): MarkdownWorkspaceResult {
    const source = this.sources.get(id)
    if (!source || source.owner !== owner) return failure(new MarkdownPolicyError('来源已失效。'))
    if (source.kind === 'directory' && scopeKey) {
      this.removePersistedPath(scopeKey, source.root)
    }
    this.sources.delete(id)
    for (const [key, value] of this.documents) if (value.sourceId === id) this.documents.delete(key)
    return { status: 'released' }
  }
  disposeOwner(ownerPrefix: string): void {
    for (const source of this.sources.values()) if (source.owner.startsWith(ownerPrefix)) this.release(source.owner, source.id)
  }
  restore(owner: string, scopeKey = 'global', projectPath?: string): MarkdownWorkspaceResult {
    try {
      if (projectPath) {
        try { this.grant(owner, projectPath, 'directory', 'project', scopeKey) } catch { /* 忽略不可用项目 */ }
      }
      const savedPaths = this.loadPersistedPaths(scopeKey)
      for (const savedPath of savedPaths) {
        try {
          if (existsSync(savedPath)) {
            this.grant(owner, savedPath, 'directory', 'persisted', scopeKey)
          }
        } catch { /* 路径可能已移动或删除 */ }
      }
      const sources = [...this.sources.values()]
        .filter(item => item.owner === owner)
        .map(item => ({ id: item.id, name: item.name, kind: item.kind }))
      return { status: 'sources', sources }
    } catch (error) { return failure(error) }
  }
  createFile(owner: string, sourceId: string, path: string, name: string): MarkdownWorkspaceResult {
    try {
      const target = this.resolveSource(owner, sourceId, path)
      if (target.source.kind !== 'directory') throw new MarkdownPolicyError('目标不是目录来源。')
      let filename = name.trim()
      if (!filename) filename = 'Untitled.md'
      if (!isMarkdownFilename(filename)) filename += '.md'
      const destination = join(target.path, filename)
      if (!isWithinMarkdownRoot(destination, target.source.root)) throw new MarkdownPolicyError('不能在来源目录外创建文件。')
      if (!existsSync(destination)) {
        const titleName = basename(filename, filename.toLowerCase().endsWith('.markdown') ? '.markdown' : '.md')
        const initialContent = `# ${titleName}\n\n`
        this.atomicWrite(destination, initialContent, 0o644)
      }
      return this.read(owner, sourceId, relative(target.source.root, destination))
    } catch (error) { return failure(error) }
  }
  private resolveSource(owner: string, id: string, path: string): { source: SourceGrant; path: string } {
    const source = this.sources.get(id)
    if (!source || source.owner !== owner || !isSafeMarkdownPath(path)) throw new MarkdownPolicyError('文件来源或路径未获授权。')
    // 不能把一个已被替换为 symlink 的来源根重新解释为新授权。
    if (realpathSync(source.root) !== source.root) throw new MarkdownPolicyError('来源路径身份已变化，请重新打开。')
    if (source.kind === 'directory') {
      const stat = statSync(source.root)
      if (`${stat.dev}:${stat.ino}` !== source.rootIdentity) throw new MarkdownPolicyError('来源目录身份已变化，请重新打开。')
    }
    if (source.kind === 'file' && path !== '') throw new MarkdownPolicyError('此授权仅包含所选文件。')
    const target = realpathSync(source.kind === 'file' ? source.root : resolve(source.root, path))
    if (source.kind === 'directory' && !isWithinMarkdownRoot(target, source.root)) throw new MarkdownPolicyError('符号链接越出来源目录。')
    return { source, path: target }
  }
  list(owner: string, id: string, path: string): MarkdownWorkspaceResult {
    try {
      const resolved = this.resolveSource(owner, id, path)
      if (resolved.source.kind === 'file') return { status: 'entries', entries: [{ name: resolved.source.name, path: '', kind: 'file' }] }
      if (!statSync(resolved.path).isDirectory()) throw new MarkdownPolicyError('不是目录。')
      const entries = readdirSync(resolved.path, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink() && (entry.isDirectory() || (entry.isFile() && isMarkdownFilename(entry.name)))).map(entry => ({ name: entry.name, path: relative(resolved.source.root, join(resolved.path, entry.name)), kind: entry.isDirectory() ? 'directory' as const : 'file' as const }))
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
      return { status: 'entries', entries }
    } catch (error) { return failure(error) }
  }
  read(owner: string, id: string, path: string): MarkdownWorkspaceResult {
    try {
      const target = this.resolveSource(owner, id, path)
      if (!isMarkdownFilename(target.path)) throw new MarkdownPolicyError('仅支持 .md 与 .markdown 文件。')
      const stat = lstatSync(target.path)
      if (!stat.isFile()) throw new MarkdownPolicyError('不是普通文件。')
      if (stat.size > MARKDOWN_FILE_LIMIT) return { status: 'error', code: 'too-large', message: '文件超过 5 MiB，请用系统编辑器打开。' }
      const bytes = readSnapshotBytes(target.path, stat)
      if (bytes.length > MARKDOWN_FILE_LIMIT) return { status: 'error', code: 'too-large', message: '文件超过 5 MiB。' }
      let content: string
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
      catch { return { status: 'error', code: 'invalid', message: '文件不是有效 UTF-8，未尝试改写。' } }
      if (content.includes('\0')) return { status: 'error', code: 'invalid', message: '文件包含二进制内容，未尝试改写。' }
      const bom = content.startsWith('\uFEFF'); if (bom) content = content.slice(1)
      const crlf = content.includes('\r\n')
      // 普通文件只保存整体风格；混合文件保存紧凑序列，避免只编辑文字时统一换行。
      let lineEndings = ''
      if (crlf && content.replace(/\r\n/g, '').includes('\n')) {
        for (const match of content.matchAll(/\r\n|\n/g)) lineEndings += match[0] === '\r\n' ? 'c' : 'l'
      }
      const existing = [...this.documents.values()].find(item => item.owner === owner && item.sourceId === id && item.document.path === path)
      const document: MarkdownWorkspaceDocument = {
        id: existing?.document.id ?? randomUUID(), sourceId: id, name: basename(target.path), path,
        content: content.replace(/\r\n/g, '\n'), revision: this.revision(bytes, stat), writable: (stat.mode & 0o222) !== 0,
        sourceOnly: bytes.length > MARKDOWN_RICH_LIMIT,
      }
      this.documents.set(document.id, { owner, sourceId: id, realPath: target.path, bom, crlf, lineEndings, mode: stat.mode & 0o777, document })
      return { status: 'document', document }
    } catch (error) { return failure(error) }
  }
  /** chosenPath 仅来自原生另存 dialog，不接受 renderer 输入。 */
  saveAs(owner: string, documentId: string, content: string, chosenPath: string): MarkdownWorkspaceResult {
    try {
      if (!documentId.startsWith('untitled:')) this.authorizedDocumentPath(owner, documentId)
      if (!isMarkdownFilename(chosenPath) || typeof content !== 'string' || content.includes('\0')) throw new MarkdownPolicyError('请选择 .md 文件。')
      if (Buffer.byteLength(content) > MARKDOWN_FILE_LIMIT) return { status: 'error', code: 'too-large', message: '草稿超过 5 MiB。' }
      // 固定已授权目标的真实父目录，拒绝已有 symlink，避免写入其目标。
      const parent = realpathSync(resolve(chosenPath, '..'))
      const destination = join(parent, basename(chosenPath))
      let mode = 0o600
      try {
        const stat = lstatSync(destination)
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o222) === 0) throw new MarkdownPolicyError('另存目标不是可写普通文件。')
        mode = stat.mode & 0o777
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      }
      this.atomicWrite(destination, content, mode)
      const source = this.grant(owner, destination, 'file')
      const read = this.read(owner, source.id, '')
      return read.status === 'document' ? { status: 'saved', document: read.document, source } : read
    } catch (error) { return failure(error) }
  }
  private revision(bytes: Buffer, stat: Stats): string {
    return createHash('sha256').update(bytes).update(`${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}:${stat.mode}`).digest('hex')
  }
  authorizedDocumentPath(owner: string, documentId: string): string {
    const snapshot = this.documents.get(documentId)
    if (!snapshot || snapshot.owner !== owner) throw new MarkdownPolicyError('文档未获授权。')
    const current = this.resolveSource(owner, snapshot.sourceId, snapshot.document.path).path
    if (current !== snapshot.realPath) throw new MarkdownPolicyError('文件路径身份已变化，请重新打开。')
    return current
  }
  save(owner: string, documentId: string, content: string, expectedRevision: string): MarkdownWorkspaceResult {
    try {
      if (typeof content !== 'string' || typeof expectedRevision !== 'string' || content.includes('\0')) return { status: 'error', code: 'invalid', message: '无效保存请求。' }
      const path = this.authorizedDocumentPath(owner, documentId)
      const snapshot = this.documents.get(documentId)!
      const stat = lstatSync(path)
      if (!stat.isFile() || (stat.mode & 0o222) === 0) throw new MarkdownPolicyError('文件为只读或已不是普通文件。')
      if (stat.size > MARKDOWN_FILE_LIMIT) return { status: 'error', code: 'too-large', message: '磁盘文件超过 5 MiB，未覆盖。' }
      const bytes = readSnapshotBytes(path, stat)
      if (expectedRevision !== snapshot.document.revision || this.revision(bytes, stat) !== expectedRevision) return { status: 'error', code: 'conflict', message: '文件已被外部编辑器或 Agent 修改。草稿已保留，请重新读取、比较或另存。' }
      const normalized = content.replace(/\r\n/g, '\n')
      let newlineIndex = 0
      const restored = snapshot.lineEndings ? normalized.replace(/\n/g, () => {
        const ending = snapshot.lineEndings[newlineIndex++]
        return ending === 'l' ? '\n' : ending === 'c' || snapshot.crlf ? '\r\n' : '\n'
      }) : snapshot.crlf ? normalized.replace(/\n/g, '\r\n') : normalized
      const output = (snapshot.bom ? '\uFEFF' : '') + restored
      if (Buffer.byteLength(output) > MARKDOWN_FILE_LIMIT) return { status: 'error', code: 'too-large', message: '草稿超过 5 MiB，未写入。' }
      this.atomicWrite(path, output, stat.mode & 0o777)
      const read = this.read(owner, snapshot.sourceId, snapshot.document.path)
      return read.status === 'document' ? { status: 'saved', document: read.document } : read
    } catch (error) { return failure(error) }
  }
}
