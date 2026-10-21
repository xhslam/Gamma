/** 外部 CLI Agent 的可观察任务；不是 Pi 会话，也不代表完整系统审计。 */
export type AgyTaskStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopping' | 'cancelled' | 'timed_out' | 'interrupted'

export interface AgyTask {
  id: string
  sessionId: string
  title: string
  prompt: string
  model?: string
  cwd: string
  status: AgyTaskStatus
  startedAt: number
  completedAt?: number
  permissionMode?: string
  conversationId?: string
  response?: string
  structuredOutput?: unknown
  outputIncomplete?: boolean
  error?: string
  usage?: Record<string, number>
  durationSeconds?: number
  exitCode?: number
  lastSequence: number
  truncated?: boolean
}

export interface AgyActivityEvent {
  sequence: number
  timestamp: number
  kind: 'init' | 'text' | 'tool' | 'result' | 'stderr' | 'unknown' | 'warning'
  stepIndex?: number
  state?: string
  text?: string
  toolName?: string
  details?: unknown
}

export interface AgyTaskSnapshot {
  task: AgyTask
  events: AgyActivityEvent[]
  nextSequence?: number
}

export interface AgyTaskUpdate {
  task: AgyTask
  events: AgyActivityEvent[]
  reveal?: boolean
}

export interface AgyTaskStartInput {
  title?: string
  prompt: string
  model?: string
  cwd?: string
  timeoutSeconds?: number
  schema?: string
}

export const AGY_IPC_CHANNELS = {
  LIST: 'agy:list',
  READ: 'agy:read',
  STOP: 'agy:stop',
  UPDATE: 'agy:update',
} as const
