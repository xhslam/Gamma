import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { AgyActivityEvent, AgyTask, AgyTaskSnapshot } from '@gamma/shared'
import { writeTextFileAtomic } from './safe-file'

const PAGE_SIZE = 200
const SEGMENT_SIZE = 100
export const AGY_MAX_EVENTS = 5_000
export const AGY_MAX_LOG_BYTES = 8 * 1024 * 1024
const ID = /^[a-zA-Z0-9-]{1,100}$/

/** 路径只来自受控工作台和生成的 ID；拒绝跟随日志目录/文件 symlink。 */
export class AgyTaskStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.assertRegular(directory, true)
    chmodSync(directory, 0o700)
  }

  private assertRegular(path: string, directory = false): void {
    if (!existsSync(path)) return
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('外部任务日志路径不安全')
  }

  private taskDir(id: string, create = false): string {
    if (!ID.test(id)) throw new Error('无效外部任务 ID')
    const path = join(this.directory, id)
    this.assertRegular(path, true)
    if (create) mkdirSync(path, { mode: 0o700 })
    return path
  }

  save(task: AgyTask, events: AgyActivityEvent[]): void {
    const dir = this.taskDir(task.id, !existsSync(join(this.directory, task.id)))
    // 小段重写有固定上限，避免流式输出反复重写完整日志。
    const grouped = new Map<number, AgyActivityEvent[]>()
    for (const event of events) {
      if (event.sequence < 1 || event.sequence > AGY_MAX_EVENTS + 1) continue
      const index = Math.floor((event.sequence - 1) / SEGMENT_SIZE)
      const group = grouped.get(index) ?? []
      group.push(event)
      grouped.set(index, group)
    }
    for (const [index, incoming] of grouped) {
      const path = join(dir, `${index}.jsonl`)
      this.assertRegular(path)
      const previous = existsSync(path) ? this.readSegment(path) : []
      const combined = new Map(previous.map(event => [event.sequence, event]))
      for (const event of incoming) combined.set(event.sequence, event)
      writeTextFileAtomic(path, [...combined.values()].sort((a, b) => a.sequence - b.sequence).map(event => JSON.stringify(event)).join('\n') + '\n', 0o600)
    }
    const meta = join(dir, 'task.json')
    this.assertRegular(meta)
    writeTextFileAtomic(meta, JSON.stringify(task), 0o600)
  }

  /** 仅接受已创建任务的私有输入；使用原子写封装，禁止跟随用户放置的 symlink。 */
  writeSchemaInput(id: string, schema: string): string {
    const path = join(this.taskDir(id), 'input-schema.json')
    this.assertRegular(path)
    writeTextFileAtomic(path, schema, 0o600)
    return path
  }

  clearSchemaInput(id: string): void {
    const path = join(this.taskDir(id), 'input-schema.json')
    this.assertRegular(path)
    if (existsSync(path)) unlinkSync(path)
  }

  get(id: string): AgyTask | undefined {
    const path = join(this.taskDir(id), 'task.json')
    this.assertRegular(path)
    if (!existsSync(path) || lstatSync(path).size > 2 * 1024 * 1024) return undefined
    try {
      // 原子封装不会留下半份元数据；不尝试读取未核验的 .tmp/.bak 旁路路径。
      const task = JSON.parse(readFileSync(path, 'utf8')) as AgyTask
      if (!task || task.id !== id || typeof task.sessionId !== 'string' || !Number.isInteger(task.lastSequence)) return undefined
      return task
    } catch { return undefined }
  }

  list(sessionId: string): AgyTask[] {
    return readdirSync(this.directory).filter(name => ID.test(name)).flatMap(id => {
      try {
        const task = this.get(id)
        return task?.sessionId === sessionId ? [task] : []
      } catch { return [] }
    }).sort((a, b) => b.startedAt - a.startedAt).slice(0, 100)
  }

  read(task: AgyTask, afterSequence = 0): AgyTaskSnapshot {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > AGY_MAX_EVENTS + 1) throw new Error('无效日志游标')
    const dir = this.taskDir(task.id)
    const events: AgyActivityEvent[] = []
    const last = Math.min(task.lastSequence, AGY_MAX_EVENTS + 1)
    for (let index = Math.floor(afterSequence / SEGMENT_SIZE); index <= Math.floor((last - 1) / SEGMENT_SIZE); index++) {
      const path = join(dir, `${index}.jsonl`)
      if (!existsSync(path)) continue
      this.assertRegular(path)
      events.push(...this.readSegment(path).filter(event => event.sequence > afterSequence && event.sequence <= last))
      if (events.length > PAGE_SIZE) break
    }
    const page = events.slice(0, PAGE_SIZE)
    return { task, events: page, ...(events.length > PAGE_SIZE && page.length ? { nextSequence: page[page.length - 1]!.sequence } : {}) }
  }

  private readSegment(path: string): AgyActivityEvent[] {
    if (lstatSync(path).size > AGY_MAX_LOG_BYTES) throw new Error('外部任务日志分段过大')
    return readFileSync(path, 'utf8').split('\n').flatMap(line => {
      if (!line.trim()) return []
      try {
        const event = JSON.parse(line) as AgyActivityEvent
        return Number.isSafeInteger(event.sequence) && event.sequence > 0 && typeof event.kind === 'string' ? [event] : []
      } catch { return [] }
    })
  }
}
