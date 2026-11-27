import { describe, expect, test } from 'bun:test'
import type { AgentStreamEvent } from '@carpus/shared'
import { AgentStreamReplay } from './agent-stream-replay'
import { AgentStreamRouteRegistry } from './agent-stream-route-registry'

function delta(sessionId: string, uuid: string, text: string): AgentStreamEvent {
  return { sessionId, payload: { kind: 'sdk_delta', delta: { uuid, deltas: [{ type: 'text_delta', contentIndex: 0, delta: text }] } } }
}

describe('独立任务窗口流式交接', () => {
  test('拆窗和归还使用同一个运行 owner，交接前的增量可重放', () => {
    const journal = new AgentStreamReplay()
    const routes = new AgentStreamRouteRegistry<{ isDestroyed(): boolean }>()
    const main = { isDestroyed: () => false }
    const detached = { isDestroyed: () => false }
    const run = routes.bind('s', main)
    const beforeDetach = delta('s', 'msg', '前段')
    journal.record(beforeDetach)
    routes.rebind('s', detached)
    expect(routes.getTargetIfOwner('s', run.ownerId)).toBe(detached)
    expect(journal.read('s')).toEqual([beforeDetach])

    const beforeReturn = delta('s', 'msg', '中段')
    journal.record(beforeReturn)
    journal.record(delta('another', 'msg', '不应串流'))
    routes.rebind('s', main)
    expect(routes.getTargetIfOwner('s', run.ownerId)).toBe(main)
    expect(journal.read('s')).toEqual([beforeDetach, beforeReturn])
    const afterReturn = delta('s', 'msg', '后段')
    journal.record(afterReturn)
    expect(journal.read('s')).toEqual([beforeDetach, beforeReturn, afterReturn])
    expect(routes.removeIfOwner('s', run.ownerId)).toBe(true)
    journal.clear('s')
    expect(journal.read('s')).toEqual([])
    expect(journal.read('another')).toHaveLength(1)
  })

  test('终态消息替代之前的增量，避免重放时重复追加文本', () => {
    const journal = new AgentStreamReplay()
    const other = delta('s', 'still-live', '尚无终态')
    const final = { sessionId: 's', payload: { kind: 'sdk_message', message: {
      type: 'assistant', uuid: 'finished', message: { content: [{ type: 'text', text: '完整正文' }] },
    } } } as AgentStreamEvent
    journal.record(delta('s', 'finished', '第一段'))
    journal.record(other)
    journal.record(delta('s', 'finished', '第二段'))
    journal.record(final)
    expect(journal.read('s')).toEqual([other, final])
  })

})
