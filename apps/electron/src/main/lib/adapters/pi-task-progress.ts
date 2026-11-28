import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { parseThinkTagsFromText } from '@carpus/session-core'

export interface CarpusTaskItem {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'error' | 'deleted'
  description?: string
  activeForm?: string
  blocks?: string[]
}

const TASK_MUTATION_TOOLS = new Set(['TaskCreate', 'TaskUpdate'])
const PROGRESS_CONTROL_TOOLS = new Set([
  ...TASK_MUTATION_TOOLS,
  'TaskGet', 'TaskList', 'TodoRead', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'CompactContext',
])
const WORK_TOOLS_BEFORE_REMINDER = 3
const WORK_TOOLS_BEFORE_VISIBLE_PROGRESS = 5

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTaskStatus(value: unknown): value is CarpusTaskItem['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
    || value === 'blocked' || value === 'cancelled' || value === 'error' || value === 'deleted'
}

function parseTask(value: unknown): CarpusTaskItem | undefined {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')
    || !String(value.id).trim()
    || typeof value.subject !== 'string' || !isTaskStatus(value.status)) return undefined
  return {
    id: String(value.id),
    subject: value.subject,
    status: value.status,
    ...(typeof value.description === 'string' && { description: value.description }),
    ...(typeof value.activeForm === 'string' && { activeForm: value.activeForm }),
    ...(Array.isArray(value.blocks) && value.blocks.every((block) => typeof block === 'string')
      && { blocks: value.blocks as string[] }),
  }
}

function taskFromResult(result: unknown): CarpusTaskItem | undefined {
  if (!isRecord(result)) return undefined
  if (isRecord(result.details)) {
    const task = parseTask(result.details.task)
    if (task) return task
  }
  // 兼容没有 details 的旧 Pi artifact；只读取文本，忽略图片和其他二进制内容。
  const text = typeof result.content === 'string'
    ? result.content
    : Array.isArray(result.content)
      ? result.content.filter(isRecord).map((block) => typeof block.text === 'string' ? block.text : '').join('')
      : ''
  try {
    const payload: unknown = JSON.parse(text)
    return isRecord(payload) ? parseTask(payload.task) : undefined
  } catch {
    return undefined
  }
}

function isOpenTask(task: CarpusTaskItem): boolean {
  return task.status === 'pending' || task.status === 'in_progress' || task.status === 'blocked'
}

/** 每次 query 独立维护任务表，仅从当前会话分支的实际结果恢复。 */
export class CarpusTaskProgressController {
  readonly tasks = new Map<string, CarpusTaskItem>()
  private workToolsSinceUpdate = 0
  private workToolsSinceVisibleProgress = 0

  constructor(messages: readonly unknown[] = [], private readonly remindVisibleProgress = false) {
    for (const message of messages) {
      if (!isRecord(message) || message.role !== 'toolResult' || message.isError === true
        || typeof message.toolName !== 'string' || !TASK_MUTATION_TOOLS.has(message.toolName)) continue
      const task = taskFromResult(message)
      if (task) this.tasks.set(task.id, task)
    }
  }

  createExtension(): (pi: ExtensionAPI) => void {
    return (pi) => {
      if (this.remindVisibleProgress) {
        pi.on('message_end', ({ message }) => {
          if (message.role === 'user' || (message.role === 'assistant' && message.content.some((block) => (
            block.type === 'text' && typeof block.text === 'string' && parseThinkTagsFromText(block.text).some((visible) => (
              visible.type === 'text' && typeof visible.text === 'string' && /[^\s\u200B-\u200D\u2060\uFEFF]/.test(visible.text)
            ))
          )))) this.workToolsSinceVisibleProgress = 0
        })
      }
      pi.on('tool_execution_end', (event) => {
        if (TASK_MUTATION_TOOLS.has(event.toolName)) {
          if (!event.isError) {
            const task = taskFromResult(event.result)
            if (task) {
              this.tasks.set(task.id, task)
              this.workToolsSinceUpdate = 0
            }
          }
          return
        }
        if (PROGRESS_CONTROL_TOOLS.has(event.toolName)) return
        if (this.remindVisibleProgress && !event.parentToolCallId) this.workToolsSinceVisibleProgress += 1
        if ([...this.tasks.values()].some(isOpenTask)) this.workToolsSinceUpdate += 1
      })
      pi.on('context', (event) => {
        // 只进入原定的下一次模型请求，不增加请求，也不写入用户消息历史。
        const reminders: string[] = []
        if (this.workToolsSinceVisibleProgress >= WORK_TOOLS_BEFORE_VISIBLE_PROGRESS) {
          this.workToolsSinceVisibleProgress = 0
          reminders.push('Carpus 可见进度提醒：已连续做了多步，没有新的用户可见回复。如果还要继续工作，先在普通回复正文里用一句话说清真实发现或下一步，再调用工具。如果现在即可交付，直接给最终结果。不要只更新任务表代替回复。')
        }
        if (this.workToolsSinceUpdate >= WORK_TOOLS_BEFORE_REMINDER) {
          this.workToolsSinceUpdate = 0
          const openTasks = [...this.tasks.values()].filter(isOpenTask)
          if (openTasks.length > 0) {
            const snapshot = openTasks.map(({ id, subject, status, activeForm }) => ({ id, subject, status, activeForm }))
            reminders.push(`Carpus 任务清单同步提醒：已连续执行多个工作工具，请核对任务表是否仍对应当前实际阶段。下面仅列出已成功任务工具确认的状态，并不代表最新实际进展：\n${JSON.stringify(snapshot)}\n若已完成一个阶段或正在进入下一阶段，立即用 TaskUpdate 同步对应任务的 status 和 activeForm；仍在同一阶段则继续工作。不得根据工具数量推断阶段、自动标记完成或伪造进度。`)
          }
        }
        if (reminders.length === 0) return undefined
        return {
          messages: [...event.messages, {
            role: 'user' as const,
            content: reminders.join('\n\n'),
            timestamp: Date.now(),
          }],
        }
      })
    }
  }
}
