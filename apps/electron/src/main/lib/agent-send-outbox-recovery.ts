import type { AgentQueuedMessageControlInput, AgentSendOutboxEntry, AgentSendOutboxRetryResult, AgentSubmitOrEnqueueInput, AgentSubmitOrEnqueueResult } from '@gamma/shared'
import type { AgentSendOutbox } from './agent-send-outbox'

interface AgentSendOutboxRecoveryOptions {
  outbox: AgentSendOutbox
  readAcceptedIds: (sessionId: string) => ReadonlySet<string>
  queuedIds: (sessionId: string) => ReadonlySet<string>
  isBusy: (sessionId: string) => boolean
  prepareRetryInput: (entry: AgentSendOutboxEntry) => AgentSubmitOrEnqueueInput
}

/** 业务恢复策略可独立测试，不加载 Electron 或真实 runtime。 */
export class AgentSendOutboxRecovery {
  private readonly retrying = new Map<string, Promise<AgentSendOutboxRetryResult>>()
  constructor(private readonly options: AgentSendOutboxRecoveryOptions) {}

  private acknowledge(sessionId: string): ReadonlySet<string> {
    // 先确认会话与日志有效；历史读取错误时不得清理或继续发送。
    this.options.outbox.list(sessionId)
    const ids = this.options.readAcceptedIds(sessionId)
    this.options.outbox.acknowledge(sessionId, ids)
    return ids
  }

  list(sessionId: string): AgentSendOutboxEntry[] {
    this.acknowledge(sessionId)
    const queued = this.options.queuedIds(sessionId)
    const busy = this.options.isBusy(sessionId)
    return this.options.outbox.list(sessionId).filter((entry) => !queued.has(entry.id) && !(busy && entry.status === 'pending'))
  }

  save(entry: AgentSendOutboxEntry): void {
    if (!this.acknowledge(entry.sessionId).has(entry.id)) this.options.outbox.save(entry)
  }

  retry(input: AgentQueuedMessageControlInput, submit: (input: AgentSubmitOrEnqueueInput) => Promise<AgentSubmitOrEnqueueResult>): Promise<AgentSendOutboxRetryResult> {
    const key = `${input.sessionId}:${input.messageId}`
    const current = this.retrying.get(key)
    if (current) return current
    const retry = Promise.resolve().then(async (): Promise<AgentSendOutboxRetryResult> => {
      const ids = this.acknowledge(input.sessionId)
      if (ids.has(input.messageId)) return { disposition: 'accepted' }
      if (this.options.queuedIds(input.sessionId).has(input.messageId)) return { disposition: 'queued' }
      if (this.options.isBusy(input.sessionId)) throw new Error('会话仍在运行，请在本轮结束后重试')
      const entry = this.options.outbox.list(input.sessionId).find((item) => item.id === input.messageId)
      if (!entry) throw new Error('待恢复消息不存在，请刷新后重试')
      const retryInput = this.options.prepareRetryInput(entry)
      this.options.outbox.save({ ...entry, status: 'pending', error: undefined })
      try {
        const result = await submit(retryInput)
        this.acknowledge(input.sessionId)
        return result
      } catch (error) {
        // 不可读取历史时保持原 pending 日志，不能把未确认消息标为可放心再发。
        const accepted = this.acknowledge(input.sessionId)
        if (accepted.has(input.messageId)) return { disposition: 'accepted' }
        this.options.outbox.save({ ...entry, status: 'failed', error: String(error) })
        throw error
      }
    }).finally(() => { if (this.retrying.get(key) === retry) this.retrying.delete(key) })
    this.retrying.set(key, retry)
    return retry
  }
}
