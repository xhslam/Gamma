import type { ToolActivity } from '@/atoms/agent-atoms'

/** 可见进度工具名集合（用于聚合判断，与 SDKMessageRenderer 共享语义）。 */
export const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate'])

export type TaskItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'error' | 'deleted'

/** Pi 任务工具及历史兼容记录共用的终态集合。 */
export function isTerminalTaskStatus(status: TaskItemStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'error' || status === 'deleted'
}

export interface TaskItem {
  id: string
  subject: string
  status: TaskItemStatus
  activeForm?: string
}

/**
 * 全部任务进度展示共用的统计口径。
 * `completed` 是成功完成数；`terminal` 用于判断是否仍有任务活动，不能当作完成数展示。
 */
export function getTaskProgressCounts(items: TaskItem[]): {
  completed: number
  terminal: number
  total: number
  hasActive: boolean
} {
  const completed = items.filter((item) => item.status === 'completed').length
  const terminal = items.filter((item) => isTerminalTaskStatus(item.status)).length
  return {
    completed,
    terminal,
    total: items.length,
    hasActive: terminal < items.length,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * SDK tool_result content can be a raw string or an array of text blocks.
 * Keep this extraction narrow so binary/image blocks do not leak into task parsing.
 */
export function extractToolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((block) => {
      if (!isRecord(block)) return ''
      return typeof block.text === 'string' ? block.text : ''
    })
    .join('')

  return text || undefined
}

export function parseTaskCreateResult(result: string | undefined): { id: string; subject?: string } | null {
  const task = parseTaskResult(result)
  const id = stringId(task?.id)
  return task && id ? { id, subject: typeof task.subject === 'string' ? task.subject : undefined } : null
}

/** TaskCreate/TaskUpdate 返回的是执行后的完整任务快照。 */
function parseTaskResult(result: string | undefined): Record<string, unknown> | null {
  if (!result) return null
  const task = parseJsonObject(result)?.task
  return isRecord(task) ? task : null
}

function toTaskStatus(value: unknown, fallback: TaskItemStatus = 'pending'): TaskItemStatus {
  if (
    value === 'pending'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'blocked'
    || value === 'cancelled'
    || value === 'error'
    || value === 'deleted'
  ) {
    return value
  }
  return fallback
}

function stringId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function taskIdFromInput(input: Record<string, unknown>): string | undefined {
  return stringId(input.taskId ?? input.task_id ?? input.id)
}

/**
 * 从 ToolActivity[] 中提取并聚合所有任务项的最新状态。
 *
 * 策略：
 * 1. 仅应用已执行成功的任务工具，以 `{ task }` 结果为准；历史无快照记录兼容 input。
 * 2. TaskUpdate 通过 taskId 更新已有条目，跨 turn 时可用历史 subject 恢复任务名。
 * 3. run 结束只影响动画，不能改写已确认的任务状态。
 */
export function aggregateTaskItems(
  activities: ToolActivity[],
  _streamEnded: boolean,
  historicalTaskSubjects?: Map<string, string>,
): TaskItem[] {
  const taskMap = new Map<string, TaskItem>()

  for (const activity of activities) {
    if (!TASK_TOOL_NAMES.has(activity.toolName) || !activity.done || activity.isError) continue
    const task = parseTaskResult(activity.result)
    // 执行结果优先，兼容没有结构化快照的旧任务工具记录。
    const confirmed = { ...activity.input, ...task }
    if (activity.toolName === 'TaskCreate') {
      const id = stringId(task?.id) ?? activity.toolUseId
      const subject = typeof confirmed.subject === 'string'
        ? confirmed.subject
        : (typeof confirmed.description === 'string' ? confirmed.description : '未命名任务')

      taskMap.set(id, {
        id,
        subject,
        status: toTaskStatus(confirmed.status),
        activeForm: typeof confirmed.activeForm === 'string' ? confirmed.activeForm : undefined,
      })
    } else if (activity.toolName === 'TaskUpdate') {
      const taskId = stringId(task?.id) ?? taskIdFromInput(activity.input)
      if (!taskId) continue

      const existing = taskMap.get(taskId)
      const status = toTaskStatus(confirmed.status, existing?.status ?? 'pending')

      if (existing) {
        taskMap.set(taskId, {
          ...existing,
          status,
          ...(typeof confirmed.subject === 'string' && { subject: confirmed.subject }),
          ...(typeof confirmed.activeForm === 'string' && { activeForm: confirmed.activeForm }),
        })
      } else {
        taskMap.set(taskId, {
          id: taskId,
          subject: typeof confirmed.subject === 'string'
            ? confirmed.subject
            : historicalTaskSubjects?.get(taskId) ?? `任务 #${taskId}`,
          status,
          activeForm: typeof confirmed.activeForm === 'string' ? confirmed.activeForm : undefined,
        })
      }
    }
  }

  return Array.from(taskMap.values()).filter((t) => t.status !== 'deleted')
}
