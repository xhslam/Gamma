import { describe, expect, test } from 'bun:test'
import { TerminalViewRegistry } from './terminal-view-registry'

describe('终端解析资源生命周期', () => {
  test('Given 切换标签或会话 When 同一终端再次绑定 Then 复用解析器而不是重放历史查询', () => {
    let creates = 0
    const registry = new TerminalViewRegistry<{ sessionId: string; dispose(): void }>()
    const create = () => { creates++; return { sessionId: 's1', dispose() {} } }
    const first = registry.acquire('t1', 's1', create)
    registry.retainOnly(new Set(['t1']))
    expect(registry.acquire('t1', 's1', create)).toBe(first)
    expect(creates).toBe(1)
    expect(() => registry.acquire('t1', 's2', create)).toThrow('终端不属于当前会话')
  })

  test('Given 后台和前台终端 When 显式关闭一个 Tab Then 仅回收该实例且重复关闭幂等', () => {
    const disposed: string[] = []
    const registry = new TerminalViewRegistry<{ sessionId: string; dispose(): void }>()
    for (const id of ['t1', 't2']) registry.acquire(id, id, () => ({ sessionId: id, dispose: () => disposed.push(id) }))
    registry.retainOnly(new Set(['t2']))
    registry.remove('t1')
    expect(disposed).toEqual(['t1'])
    registry.retainOnly(new Set())
    expect(disposed).toEqual(['t1', 't2'])
  })
})
