import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgyTask } from '@gamma/shared'
import { AgyTaskStore } from './agy-task-store'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'gamma-agy-store-')); roots.push(root)
  const store = new AgyTaskStore(join(root, 'tasks'))
  const task: AgyTask = { id: 'test-task', sessionId: 'owner', title: '测试', prompt: 'hello', cwd: root, status: 'completed', startedAt: 1, lastSequence: 301 }
  return { root, store, task }
}

describe('Given 外部任务私有分段日志', () => {
  test('When 写入与分页读取 Then 事件连续、无重复并按会话隔离', () => {
    const { store, task, root } = setup()
    store.save(task, Array.from({ length: 301 }, (_, i) => ({ sequence: i + 1, timestamp: i, kind: 'text' as const, text: `事件 ${i}` })))
    expect(store.list('other')).toEqual([])
    expect(store.list('owner')).toHaveLength(1)
    const page = store.read(task)
    expect(page.events).toHaveLength(200)
    expect(page.nextSequence).toBe(200)
    const rest = store.read(task, page.nextSequence)
    expect(rest.events).toHaveLength(101)
    expect(rest.events[0]?.sequence).toBe(201)
    expect(rest.nextSequence).toBeUndefined()
    if (process.platform !== 'win32') expect(statSync(join(root, 'tasks', task.id, 'task.json')).mode & 0o777).toBe(0o600)
  })
  test('When 重写同一日志段 Then 按序号去重保留之前事件', () => {
    const { store, task } = setup()
    store.save(task, [{ sequence: 1, timestamp: 1, kind: 'text', text: 'a' }])
    store.save(task, [{ sequence: 2, timestamp: 2, kind: 'text', text: 'b' }])
    expect(store.read(task).events.map(event => event.text)).toEqual(['a', 'b'])
  })
  test('When 路径穿越或日志损坏 Then 拒绝越界且可读取有效事件', () => {
    const { store, task, root } = setup()
    expect(() => store.get('../escape')).toThrow()
    store.save(task, [])
    writeFileSync(join(root, 'tasks', task.id, '0.jsonl'), '{broken}\n' + JSON.stringify({ sequence: 1, timestamp: 1, kind: 'text', text: '保留' }) + '\n')
    expect(store.read(task).events[0]?.text).toBe('保留')
    expect(() => store.read(task, -1)).toThrow()
  })
  test('When 临时 Schema 写入与清理 Then 使用受控任务目录且不影响日志', () => {
    const { store, task } = setup()
    store.save(task, [])
    const path = store.writeSchemaInput(task.id, '{"type":"object"}')
    expect(readFileSync(path, 'utf8')).toBe('{"type":"object"}')
    store.clearSchemaInput(task.id)
    store.clearSchemaInput(task.id)
    expect(existsSync(path)).toBe(false)
    expect(store.get(task.id)?.id).toBe(task.id)
    expect(() => store.writeSchemaInput('../escape', '{}')).toThrow()
  })
  test('When 任务目录是 symlink 或 Windows junction Then 拒绝跟随目录写 Schema', () => {
    const { root, store } = setup()
    const target = join(root, 'outside'); mkdirSync(target)
    symlinkSync(target, join(root, 'tasks', 'linked-task'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => store.writeSchemaInput('linked-task', '{}')).toThrow('不安全')
    expect(existsSync(join(target, 'input-schema.json'))).toBe(false)
  })
  test.skipIf(process.platform === 'win32')('When 日志或 Schema 文件是 symlink Then 不覆盖目标文件（需 POSIX 文件链接权限）', () => {
    const { store, task, root } = setup()
    store.save(task, [])
    const target = join(root, 'target.txt'); writeFileSync(target, '不覆盖')
    symlinkSync(target, join(root, 'tasks', task.id, '1.jsonl'))
    expect(() => store.save(task, [{ sequence: 101, timestamp: 1, kind: 'text' }])).toThrow()
    symlinkSync(target, join(root, 'tasks', task.id, 'input-schema.json'))
    expect(() => store.writeSchemaInput(task.id, '{}')).toThrow('不安全')
    expect(() => store.clearSchemaInput(task.id)).toThrow('不安全')
    expect(readFileSync(target, 'utf8')).toBe('不覆盖')
  })
})
