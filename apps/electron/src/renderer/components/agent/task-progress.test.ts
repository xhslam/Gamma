import { describe, expect, test } from 'bun:test'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { aggregateTaskItems, isTerminalTaskStatus } from './task-progress'

function activity(toolName: string, input: Record<string, unknown>, result?: string): ToolActivity {
  return {
    toolUseId: `${toolName}-${++activitySequence}`,
    toolName,
    input,
    result,
    done: true,
  }
}

let activitySequence = 0

describe('任务进度聚合', () => {
  test('given Pi and Claude compatible TaskUpdate statuses when aggregating then preserves terminal and blocked states', () => {
    const activities = [
      activity('TaskUpdate', { taskId: 'done', subject: '完成项', status: 'completed' }),
      activity('TaskUpdate', { taskId: 'blocked', subject: '阻塞项', status: 'blocked' }),
      activity('TaskUpdate', { taskId: 'cancelled', subject: '取消项', status: 'cancelled' }),
      activity('TaskUpdate', { taskId: 'error', subject: '失败项', status: 'error' }),
    ]

    const items = aggregateTaskItems(activities, false)
    expect(items.map((item) => item.status)).toEqual(['completed', 'blocked', 'cancelled', 'error'])
    expect(isTerminalTaskStatus('completed')).toBe(true)
    expect(isTerminalTaskStatus('cancelled')).toBe(true)
    expect(isTerminalTaskStatus('error')).toBe(true)
    expect(isTerminalTaskStatus('blocked')).toBe(false)
  })

  test('given a legacy TodoWrite activity when aggregating then ignores the snapshot instead of showing false progress', () => {
    const activities = [activity('TodoWrite', {
      todos: [{ subject: '不应展示', status: 'in_progress' }],
    })]

    expect(aggregateTaskItems(activities, false)).toEqual([])
  })

  test('given a TaskCreate tool result and update when aggregating then links the SDK task id', () => {
    const activities = [
      activity('TaskCreate', { subject: '检查实现' }, JSON.stringify({ task: { id: '42', subject: '检查实现' } })),
      activity('TaskUpdate', { taskId: '42', status: 'in_progress', activeForm: '正在检查实现' }),
    ]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: '42', subject: '检查实现', status: 'in_progress', activeForm: '正在检查实现' },
    ])
  })

  test('given an update without a current-turn create when aggregating without history then does not recover a prior turn subject', () => {
    const activities = [activity('TaskUpdate', { taskId: 'prior-task', status: 'in_progress' })]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: 'prior-task', subject: '任务 #prior-task', status: 'in_progress', activeForm: undefined },
    ])
    expect(aggregateTaskItems(activities, false, new Map([['prior-task', '历史任务']]))).toEqual([
      { id: 'prior-task', subject: '历史任务', status: 'in_progress', activeForm: undefined },
    ])
  })

  test('given a failed TaskUpdate when aggregating then keeps the last confirmed stage', () => {
    const activities = [
      activity('TaskCreate', { subject: '验证实现' }, JSON.stringify({ task: { id: 'verify', subject: '验证实现' } })),
      activity('TaskUpdate', { taskId: 'verify', status: 'in_progress', activeForm: '正在运行测试' }),
      { ...activity('TaskUpdate', { taskId: 'verify', status: 'completed' }), isError: true },
    ]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: 'verify', subject: '验证实现', status: 'in_progress', activeForm: '正在运行测试' },
    ])
  })

  test('given a pending TaskUpdate when aggregating then waits for execution before advancing the stage', () => {
    const activities = [
      activity('TaskUpdate', { taskId: 'verify', subject: '验证实现', status: 'in_progress' }),
      { ...activity('TaskUpdate', { taskId: 'verify', status: 'completed' }), done: false },
    ]

    expect(aggregateTaskItems(activities, false)[0]?.status).toBe('in_progress')
  })

  test('given a confirmed TaskUpdate result when aggregating then uses the executed task snapshot', () => {
    const activities = [activity('TaskUpdate', { taskId: 'verify' }, JSON.stringify({
      task: { id: 'verify', subject: '验证实现', status: 'in_progress', activeForm: '正在运行测试' },
    }))]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: 'verify', subject: '验证实现', status: 'in_progress', activeForm: '正在运行测试' },
    ])
  })

  test('given failed or pending task creation when aggregating then does not show phantom tasks', () => {
    expect(aggregateTaskItems([
      { ...activity('TaskCreate', { subject: '未创建' }), done: false },
      { ...activity('TaskCreate', { subject: '创建失败' }), isError: true },
    ], false)).toEqual([])
  })

  test('given a run ends with unfinished work when aggregating then preserves confirmed progress', () => {
    const activities = [activity('TaskUpdate', { taskId: 'verify', subject: '验证实现', status: 'in_progress', activeForm: '正在运行测试' })]

    expect(aggregateTaskItems(activities, true)).toEqual(aggregateTaskItems(activities, false))
  })

  test('given a successful snapshot overrides the proposed status when aggregating then preserves actual progress and deletion', () => {
    const activities = [
      activity('TaskCreate', { subject: '计划阶段' }, JSON.stringify({ task: { id: 42, subject: '实际阶段', status: 'pending' } })),
      activity('TaskUpdate', { taskId: '42', status: 'completed' }, JSON.stringify({ task: { id: 42, subject: '实际阶段', status: 'blocked' } })),
    ]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: '42', subject: '实际阶段', status: 'blocked', activeForm: undefined },
    ])
    activities.push(activity('TaskUpdate', { taskId: '42', status: 'deleted' }))
    expect(aggregateTaskItems(activities, false)).toEqual([])
  })
})

describe('多阶段任务独立聚合', () => {
  test('given 创建三个独立阶段 when 更新中间阶段 then 保留三项且不覆盖其他任务', () => {
    const tasks = [
      { id: 'research', subject: '排查原因', status: 'pending' },
      { id: 'fix', subject: '实现修复', status: 'pending' },
      { id: 'verify', subject: '回归验证', status: 'pending' },
    ]
    const activities = tasks.map((task) => activity('TaskCreate', { subject: task.subject }, JSON.stringify({ task })))
    activities.push(activity('TaskUpdate', { taskId: 'research', status: 'completed' }))
    activities.push(activity('TaskUpdate', { taskId: 'fix', status: 'in_progress', activeForm: '正在修改代码' }))
    expect(aggregateTaskItems(activities, false)).toMatchObject([
      { ...tasks[0], status: 'completed' },
      { ...tasks[1], status: 'in_progress', activeForm: '正在修改代码' },
      tasks[2],
    ])
  })
})
