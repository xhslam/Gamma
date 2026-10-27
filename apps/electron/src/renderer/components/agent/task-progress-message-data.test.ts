import { describe, expect, test } from 'bun:test'
import type { SDKContentBlock, SDKMessage } from '@proma/shared'
import { buildTaskProgressData } from './SDKMessageRenderer'

const taskUpdate: SDKContentBlock = {
  type: 'tool_use',
  id: 'update-1',
  name: 'TaskUpdate',
  input: { taskId: 'task-1', status: 'completed' },
}

function resultMessage(content: string, isError = false, structuredResult?: Record<string, unknown>): SDKMessage {
  return {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'update-1', content, is_error: isError }],
    },
    ...(structuredResult && { tool_use_result: structuredResult }),
  } as SDKMessage
}

describe('任务工具执行结果提取', () => {
  test('given 任务更新尚未返回结果 when 提取活动 then 不把调用意图当作已执行', () => {
    expect(buildTaskProgressData([taskUpdate], []).taskActivities[0]?.done).toBe(false)
  })

  test('given 工具返回空文本 when 提取活动 then 仍确认工具已结束', () => {
    const activity = buildTaskProgressData([taskUpdate], [resultMessage('')]).taskActivities[0]
    expect(activity?.done).toBe(true)
    expect(activity?.isError).toBe(false)
  })

  test('given 任务更新被拒绝 when 提取活动 then 保留错误状态而不确认状态变更', () => {
    const activity = buildTaskProgressData([taskUpdate], [resultMessage('权限拒绝', true)]).taskActivities[0]
    expect(activity).toMatchObject({ done: true, isError: true, result: '权限拒绝' })
  })

  test('given Pi 返回结构化任务快照 when 提取活动 then 保留已确认任务结果', () => {
    const task = { id: 'task-1', subject: '验证实现', status: 'in_progress' }
    const activity = buildTaskProgressData([taskUpdate], [resultMessage('已更新', false, { task })]).taskActivities[0]
    expect(activity).toMatchObject({ done: true, isError: false, result: JSON.stringify({ task }) })
  })
})
