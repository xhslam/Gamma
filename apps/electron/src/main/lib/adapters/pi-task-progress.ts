import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export interface PromaTaskItem {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTaskStatus(value: unknown): value is PromaTaskItem['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
    || value === 'blocked' || value === 'cancelled' || value === 'error' || value === 'deleted'
}

function parseTask(value: unknown): PromaTaskItem | undefined {
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

function taskFromResult(result: unknown): PromaTaskItem | undefined {
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

function isOpenTask(task: PromaTaskItem): boolean {
  return task.status === 'pending' || task.status === 'in_progress' || task.status === 'blocked'
}

/** 每次 query 独立维护任务表，仅从当前会话分支的实际结果恢复。 */
export class PromaTaskProgressController {
  readonly tasks = new Map<string, PromaTaskItem>()
  private workToolsSinceUpdate = 0

  constructor(messages: readonly unknown[] = []) {
    for (const message of messages) {
      if (!isRecord(message) || message.role !== 'toolResult' || message.isError === true
        || typeof message.toolName !== 'string' || !TASK_MUTATION_TOOLS.has(message.toolName)) continue
      const task = taskFromResult(message)
      if (task) this.tasks.set(task.id, task)
    }
  }

  createExtension(): (pi: ExtensionAPI) => void {
    return (pi) => {
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
        if (!PROGRESS_CONTROL_TOOLS.has(event.toolName) && [...this.tasks.values()].some(isOpenTask)) {
          this.workToolsSinceUpdate += 1
        }
      })
      pi.on('context', (event) => {
        if (this.workToolsSinceUpdate < WORK_TOOLS_BEFORE_REMINDER) return undefined
        const openTasks = [...this.tasks.values()].filter(isOpenTask)
        if (openTasks.length === 0) return undefined
        // 每连续 3 个工作工具至多提醒一次；只进入本次模型 context，不写入用户消息历史。
        this.workToolsSinceUpdate = 0
        const snapshot = openTasks.map(({ id, subject, status, activeForm }) => ({ id, subject, status, activeForm }))
        return {
          messages: [...event.messages, {
            role: 'user' as const,
            content: `Proma 进度同步提醒：已连续执行多个工作工具，请核对任务表是否仍对应当前实际阶段。下面仅列出已成功任务工具确认的状态，并不代表最新实际进展：\n${JSON.stringify(snapshot)}\n若已完成一个阶段或正在进入下一阶段，立即用 TaskUpdate 同步对应任务的 status 和 activeForm；仍在同一阶段则继续工作。不得根据工具数量推断阶段、自动标记完成或伪造进度。`,
            timestamp: Date.now(),
          }],
        }
      })
    }
  }
}
