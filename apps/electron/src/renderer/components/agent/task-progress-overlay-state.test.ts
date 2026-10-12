import { describe, expect, test } from 'bun:test'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { aggregateTaskItems, type TaskItem } from './task-progress'
import { getTaskProgressDisplay, isSameTaskProgressRun, resolveTaskProgressRunIdentity, selectTaskProgressActivities } from './task-progress-overlay-state'

function task(status: TaskItem['status'], fields: Partial<TaskItem> = {}): TaskItem {
  return { id: 'task-1', subject: '验证实现', status, ...fields }
}

describe('任务进度浮层运行隔离', () => {
  test('given 上一轮反馈仍保留 when 新轮次开始但尚无任务 then 拒绝上一轮快照', () => {
    expect(isSameTaskProgressRun({ runGeneration: 1, startedAt: 100 }, { runGeneration: 2, startedAt: 200 })).toBe(false)
    expect(isSameTaskProgressRun({ startedAt: 100 }, { startedAt: 200 })).toBe(false)
  })

  test('given 两轮起始时间相同 when 代际不同 then 仍隔离旧进度', () => {
    expect(isSameTaskProgressRun({ runGeneration: 1, startedAt: 100 }, { runGeneration: 2, startedAt: 100 })).toBe(false)
  })

  test('given 同一轮结束或稍后补充代际 when 判断保留反馈 then 不提前丢弃快照', () => {
    expect(isSameTaskProgressRun({ startedAt: 100 }, { runGeneration: 2, startedAt: 100 })).toBe(true)
    expect(isSameTaskProgressRun({ runGeneration: 2, startedAt: 100 }, {})).toBe(true)
  })

  test('given 旧快照没有运行标记 when 新轮次有标记 then 不把旧快照归入新轮次', () => {
    expect(isSameTaskProgressRun({}, { runGeneration: 2, startedAt: 200 })).toBe(false)
  })

  test('given 同一轮任务内容未变化 when 补充代际后下一轮同时间开始 then 保存代际并隔离下一轮', () => {
    const enriched = resolveTaskProgressRunIdentity({ startedAt: 100 }, { runGeneration: 1, startedAt: 100 })
    expect(enriched).toEqual({ runGeneration: 1, startedAt: 100 })
    expect(isSameTaskProgressRun(enriched, { runGeneration: 2, startedAt: 100 })).toBe(false)
    expect(resolveTaskProgressRunIdentity(enriched, {})).toEqual(enriched)
  })
})

describe('任务进度浮层快照回放', () => {
  const created: ToolActivity = {
    toolUseId: 'task-1', toolName: 'TaskCreate', input: { subject: '调研问题' }, done: true,
  }
  const deleted: ToolActivity = {
    toolUseId: 'delete-1', toolName: 'TaskUpdate', input: { taskId: 'task-1', status: 'deleted' }, done: true,
  }

  test('given 创建任务后已确认删除 when 实时快照或随后消息清空 then 不复活已删除任务', () => {
    const deletedSnapshot = [created, deleted]
    const displayed = selectTaskProgressActivities(deletedSnapshot, [created], true)
    expect(aggregateTaskItems(displayed, false)).toEqual([])
    expect(aggregateTaskItems(selectTaskProgressActivities([], displayed, true), true)).toEqual([])
  })

  test('given 同一轮已结束 when 实时消息清空 then 仍保留最后反馈且下一轮不会沿用', () => {
    expect(aggregateTaskItems(selectTaskProgressActivities([], [created], true), true)).toMatchObject([{ subject: '调研问题' }])
    expect(selectTaskProgressActivities([], [created], false)).toEqual([])
  })

  test('given 删除调用尚未完成或失败 when 当前只收到该调用 then 保留已确认任务', () => {
    expect(selectTaskProgressActivities([{ ...deleted, done: false }], [created], true)).toEqual([created])
    expect(selectTaskProgressActivities([{ ...deleted, isError: true }], [created], true)).toEqual([created])
  })
})

describe('任务进度浮层状态语义', () => {
  test('given 正在执行任务 when Agent 仍运行 then 显示当前动作和执行动画', () => {
    expect(getTaskProgressDisplay([task('in_progress', { activeForm: '正在运行测试' })], true)).toMatchObject({
      label: '正在运行测试', running: true,
    })
  })

  test('given 任务未完成 when Agent 已结束 then 停止动画并准确显示未完成', () => {
    expect(getTaskProgressDisplay([task('in_progress', { activeForm: '正在运行测试' })], false)).toMatchObject({
      label: '任务未完成：验证实现', running: false,
    })
  })

  test('given 尚未开始的任务带有 activeForm when Agent 运行 then 显示任务目标而不假称正在执行', () => {
    expect(getTaskProgressDisplay([task('pending', { activeForm: '正在运行测试' })], true)).toMatchObject({
      label: '验证实现', running: false,
    })
  })

  test('given 所有任务已结束 when 有失败或取消 then 不把它们显示为成功完成', () => {
    expect(getTaskProgressDisplay([task('error')], false)).toMatchObject({ label: '任务执行失败', running: false })
    expect(getTaskProgressDisplay([task('cancelled')], false)).toMatchObject({ label: '任务已取消', running: false })
    expect(getTaskProgressDisplay([task('blocked')], false)).toMatchObject({ label: '任务受阻：验证实现', running: false })
    expect(getTaskProgressDisplay([task('completed')], false)).toMatchObject({ label: '任务已完成', running: false })
  })
})
