import type { ToolActivity } from '@/atoms/agent-atoms'
import { isTerminalTaskStatus, TASK_TOOL_NAMES, type TaskItem } from './task-progress'

export interface TaskProgressRunIdentity {
  runGeneration?: number
  startedAt?: number
}

/** 有代际时优先比较代际；补充代际或旧协议时以起始时间兼容，同一轮结束后允许短时保留反馈。 */
export function isSameTaskProgressRun(retained: TaskProgressRunIdentity, current: TaskProgressRunIdentity): boolean {
  if (current.runGeneration != null && retained.runGeneration != null) {
    return current.runGeneration === retained.runGeneration
  }
  if (current.startedAt != null && retained.startedAt != null) {
    return current.startedAt === retained.startedAt
  }
  return current.runGeneration == null && current.startedAt == null
}

/** 同一轮补充代际时也保存新标记；运行状态被清理时保留原身份供短时反馈使用。 */
export function resolveTaskProgressRunIdentity(retained: TaskProgressRunIdentity, current: TaskProgressRunIdentity): TaskProgressRunIdentity {
  return isSameTaskProgressRun(retained, current)
    ? { runGeneration: current.runGeneration ?? retained.runGeneration, startedAt: current.startedAt ?? retained.startedAt }
    : current
}

export function hasConfirmedTaskProgressSnapshot(activities: ToolActivity[]): boolean {
  return activities.some((activity) => TASK_TOOL_NAMES.has(activity.toolName) && activity.done && !activity.isError)
}

/** 空实时消息代表收尾清理；成功删除后的空任务表则是确认快照，不能退回旧任务。 */
export function selectTaskProgressActivities(live: ToolActivity[], retained: ToolActivity[], sameRun: boolean): ToolActivity[] {
  return hasConfirmedTaskProgressSnapshot(live) ? live : sameRun ? retained : []
}

export interface TaskProgressDisplay {
  currentTask?: TaskItem
  label: string
  running: boolean
}

/** 进度项状态与 Agent 运行状态分别判断：停止动画不会改写已确认的任务状态。 */
export function getTaskProgressDisplay(items: TaskItem[], streaming: boolean): TaskProgressDisplay {
  const currentTask = [...items].reverse().find((item) => item.status === 'in_progress')
    ?? [...items].reverse().find((item) => !isTerminalTaskStatus(item.status))
  const running = streaming && currentTask?.status === 'in_progress'
  if (currentTask?.status === 'blocked') {
    return { currentTask, label: `任务受阻：${currentTask.subject}`, running: false }
  }
  if (currentTask) {
    return {
      currentTask,
      label: streaming
        ? running ? currentTask.activeForm ?? currentTask.subject : currentTask.subject
        : `任务未完成：${currentTask.subject}`,
      running,
    }
  }
  if (items.some((item) => item.status === 'error')) {
    return { label: '任务执行失败', running: false }
  }
  if (items.some((item) => item.status === 'cancelled')) {
    return { label: '任务已取消', running: false }
  }
  return { label: items.length > 0 ? '任务已完成' : '暂无任务', running: false }
}
