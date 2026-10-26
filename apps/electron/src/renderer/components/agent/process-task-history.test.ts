import { describe, expect, test } from 'bun:test'
import type { SDKAssistantMessage, SDKContentBlock, SDKMessage } from '@gamma/shared'
import type { AssistantTurn } from '@gamma/session-core'
import { buildTaskProgressDataForProcess } from './SDKMessageRenderer'
import { aggregateTaskItems } from './task-progress'

function assistant(uuid: string, blocks: SDKContentBlock[], runGeneration = 1, startedAt = 100): SDKAssistantMessage {
  return {
    type: 'assistant', uuid, parent_tool_use_id: null, message: { content: blocks },
    _gammaLiveRunGeneration: runGeneration, _gammaLiveRunStartedAt: startedAt,
  } as SDKAssistantMessage
}
function result(id: string, task: Record<string, unknown>): SDKMessage {
  return { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify({ task }) }] } }
}
const created = assistant('created', [{ type: 'tool_use', id: 'create', name: 'TaskCreate', input: { subject: '检查布局' } }])
const createdResult = result('create', { id: 'layout', subject: '检查布局', status: 'pending' })
const updated = assistant('updated', [{ type: 'tool_use', id: 'update', name: 'TaskUpdate', input: { taskId: 'layout', status: 'in_progress' } }])
const updatedResult = result('update', { id: 'layout', subject: '检查布局', status: 'in_progress' })
const compaction: SDKMessage = { type: 'system', subtype: 'status', status: 'compacting' }
function turn(message: SDKAssistantMessage, messages: SDKMessage[] = [message]): AssistantTurn {
  return { type: 'assistant-turn', assistantMessages: [message], turnMessages: messages }
}
function items(current: AssistantTurn, all: SDKMessage[]) {
  return aggregateTaskItems(buildTaskProgressDataForProcess(current, all).taskActivities, false)
}

describe('Given 执行区内联计划的历史范围', () => {
  test('When 同一次运行被压缩分成多段 Then 保留之前创建的阶段并确认后续更新', () => {
    const current = turn(updated, [updated, updatedResult])
    const all = [created, createdResult, compaction, updated, updatedResult]
    expect(items(current, all)).toMatchObject([{ id: 'layout', subject: '检查布局', status: 'in_progress' }])
  })

  test('When 同一次运行被拆段且新段未更新旧计划 Then 之前确认的计划仍可见', () => {
    const next = assistant('next', [{ type: 'thinking', thinking: '继续检查' }])
    expect(items(turn(next), [created, createdResult, compaction, next])).toMatchObject([{ id: 'layout', subject: '检查布局', status: 'pending' }])
  })

  test('When 新的人类输入开始另一轮 Then 不从前一轮带入旧计划', () => {
    const next = assistant('next', [{ type: 'thinking', thinking: '新的问题' }])
    const input: SDKMessage = { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '新的问题' }] } }
    expect(items(turn(next), [created, createdResult, input, next])).toEqual([])
  })

  test('When 新轮次时间戳相同但代际不同 Then 仍隔离旧计划', () => {
    const next = assistant('next', [{ type: 'thinking', thinking: '新的工作' }], 2)
    expect(items(turn(next), [created, createdResult, next])).toEqual([])
  })

  test('When 历史之后出现更新 Then 不让未来状态改写此前的计划快照', () => {
    expect(items(turn(created, [created, createdResult]), [created, createdResult, updated, updatedResult])).toMatchObject([{ status: 'pending' }])
  })

  test('When 上一次正常运行已结束或后台唤醒开始新 run Then 不串用旧计划', () => {
    const next = assistant('next', [{ type: 'thinking', thinking: '后台继续' }])
    const finished = { type: 'result', subtype: 'success' } as SDKMessage
    expect(items(turn(next), [created, createdResult, finished, next])).toEqual([])
    const anotherRun = assistant('another', [{ type: 'thinking', thinking: '另一轮' }], 2, 200)
    expect(items(turn(anotherRun), [created, createdResult, anotherRun])).toEqual([])
  })

  test('When 父 turn 含子代理计划 Then 只把父任务放入内联清单', () => {
    const parent = assistant('parent', [{ type: 'tool_use', id: 'agent', name: 'Agent', input: { prompt: '检查' } }])
    const child = { ...created, uuid: 'child', parent_tool_use_id: 'agent' }
    const current = { type: 'assistant-turn', assistantMessages: [parent, child], turnMessages: [parent, child, createdResult] } satisfies AssistantTurn
    expect(items(current, current.turnMessages)).toEqual([])
  })
})
