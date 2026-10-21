import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgyTask } from '@gamma/shared'
import { AGY_EVENT_LIMIT, agyTaskKey, agyTaskViewsAtom, agyOpenTaskIdsAtom, applyAgyTaskUpdateAtom, openAgyTaskAtom, closeAgyTaskAtom, mergeAgyTaskView } from './agy-task-atoms'

const task: AgyTask = { id: 'one', sessionId: 'parent', title: '抽取', prompt: '输入', cwd: '/work', status: 'running', startedAt: 1, lastSequence: 3 }

describe('Given agy 订阅和分页快照可能乱序到达', () => {
  test('When 旧快照晚于增量 Then 保留最新任务并按序号去重排序', () => {
    const previous = mergeAgyTaskView(undefined, { task: { ...task, status: 'completed', lastSequence: 4 }, events: [{ sequence: 3, timestamp: 1, kind: 'text', text: '新' }, { sequence: 4, timestamp: 2, kind: 'result' }] })
    const merged = mergeAgyTaskView(previous, { task, events: [{ sequence: 1, timestamp: 0, kind: 'init' }, { sequence: 3, timestamp: 1, kind: 'text', text: '重复' }] })
    expect(merged.task.status).toBe('completed')
    expect(merged.events.map(event => event.sequence)).toEqual([1, 3, 4])
    expect(merged.events[1]?.text).toBe('新')
  })
  test('When 同序号旧 running 快照覆盖终态或 stopping Then 不回退状态', () => {
    for (const status of ['completed', 'stopping'] as const) {
      const previous = mergeAgyTaskView(undefined, { task: { ...task, status }, events: [] })
      expect(mergeAgyTaskView(previous, { task, events: [] }).task.status).toBe(status)
    }
  })
  test('When 同序号快照晚于订阅元数据 Then 不覆盖已收到的结果字段', () => {
    const previous = mergeAgyTaskView(undefined, { task: { ...task, response: '订阅结果' }, events: [] })
    expect(mergeAgyTaskView(previous, { task, events: [], source: 'snapshot' }).task.response).toBe('订阅结果')
    expect(mergeAgyTaskView(previous, { task: { ...task, response: '新订阅结果' }, events: [] }).task.response).toBe('新订阅结果')
  })
  test('When 事件超过上限 Then 保留有界最新记录并标记截断', () => {
    const events = Array.from({ length: AGY_EVENT_LIMIT + 20 }, (_, index) => ({ sequence: index + 1, timestamp: 0, kind: 'text' as const }))
    const merged = mergeAgyTaskView(undefined, { task, events })
    expect(merged.events.length).toBe(AGY_EVENT_LIMIT)
    expect(merged.events[0]?.sequence).toBe(21)
    expect(merged.clipped).toBe(true)
  })
})
describe('Given 不同父会话的独立外部任务标签', () => {
  test('When 打开和关闭标签 Then 幂等且不删除任务历史、不影响其他父会话', () => {
    const store = createStore()
    store.set(applyAgyTaskUpdateAtom, { task, events: [] })
    store.set(applyAgyTaskUpdateAtom, { task: { ...task, sessionId: 'other' }, events: [] })
    store.set(openAgyTaskAtom, { sessionId: 'parent', taskId: 'one' })
    store.set(openAgyTaskAtom, { sessionId: 'parent', taskId: 'one' })
    store.set(openAgyTaskAtom, { sessionId: 'other', taskId: 'one' })
    expect(store.get(agyOpenTaskIdsAtom).get('parent')).toEqual(['one'])
    store.set(closeAgyTaskAtom, { sessionId: 'parent', taskId: 'one' })
    expect(store.get(agyOpenTaskIdsAtom).get('parent')).toEqual([])
    expect(store.get(agyOpenTaskIdsAtom).get('other')).toEqual(['one'])
    expect(store.get(agyTaskViewsAtom).has(agyTaskKey('parent', 'one'))).toBe(true)
    expect(store.get(agyTaskViewsAtom).size).toBe(2)
  })
})
