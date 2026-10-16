interface AgentMessageSubmissionGateOptions {
  isPersisted: (sessionId: string, messageId: string) => boolean
  isQueued: (sessionId: string, messageId: string) => boolean
}

export type AgentMessageSubmissionOutcome<T> =
  | { duplicate: false; value: T }
  | { duplicate: true; acceptedAs: 'persisted' | 'queued' }

/** 普通发送、排队、恢复共用的主进程幂等边界；不能依赖两次 IPC 之间的 renderer 判断。 */
export class AgentMessageSubmissionGate {
  private readonly inFlight = new Map<string, Promise<unknown>>()
  constructor(private readonly options: AgentMessageSubmissionGateOptions) {}

  async submit<T>(sessionId: string, messageId: string | undefined, operation: () => Promise<T>): Promise<AgentMessageSubmissionOutcome<T>> {
    if (!messageId) return { duplicate: false, value: await operation() }
    const persisted = (): boolean => this.options.isPersisted(sessionId, messageId)
    const queued = (): boolean => this.options.isQueued(sessionId, messageId)
    if (persisted()) return { duplicate: true, acceptedAs: 'persisted' }
    if (queued()) return { duplicate: true, acceptedAs: 'queued' }
    const key = `${sessionId}:${messageId}`
    const existing = this.inFlight.get(key)
    if (existing) {
      await existing
      if (persisted()) return { duplicate: true, acceptedAs: 'persisted' }
      if (queued()) return { duplicate: true, acceptedAs: 'queued' }
      throw new Error('前一次提交尚无接收证据，已保留暂存消息，请确认后重试')
    }
    // 在 operation 执行前注册，关闭同步重入与两窗口同时到达的窗口。
    const pending = Promise.resolve().then(operation)
    this.inFlight.set(key, pending)
    try { return { duplicate: false, value: await pending } }
    finally { if (this.inFlight.get(key) === pending) this.inFlight.delete(key) }
  }
}
