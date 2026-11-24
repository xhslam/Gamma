import type { AgentCancelQueuedMessageInput, AgentQueuedMessageControlInput, AgentSendOutboxEntry, AgentSendOutboxRetryResult, AgentSubmitOrEnqueueInput, AgentSubmitOrEnqueueResult } from '@carpus/shared'
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

  /** 同步检查、落盘和取消之间不让出事件循环；落盘失败时保留原队列，不能只撤销展示。 */
  cancelQueued(input: AgentCancelQueuedMessageInput, cancel: () => boolean): boolean {
    if (!this.options.queuedIds(input.sessionId).has(input.messageId)) return false
    if (input.preserveSendOutbox !== true) this.options.outbox.discard(input.sessionId, input.messageId)
    return cancel()
  }

  /**
   * 运行在用户消息落盘前结束（门禁拒绝、预检失败等）时回写失败原因。
   * IPC 已回执“已接管”但消息从未持久化的场景，不能永远停在“发送结果待确认”。
   * 已接收、仍在队列、已被更新的重试接管（startedAt 更新）或用户主动停止的快照不得触碰。
   */
  markRunFailed(input: { sessionId: string; messageId: string; startedAt?: number; error?: string; stoppedByUser?: boolean }): void {
    if (input.stoppedByUser === true) return
    const accepted = this.acknowledge(input.sessionId)
    if (accepted.has(input.messageId)) return
    if (this.options.queuedIds(input.sessionId).has(input.messageId)) return
    const entry = this.options.outbox.list(input.sessionId).find((item) => item.id === input.messageId)
    if (!entry) return
    // 新重试的 startedAt 一定晚于旧运行；旧运行的迟到失败不能覆盖新快照。
    if (input.startedAt != null && entry.input.startedAt != null && entry.input.startedAt > input.startedAt) return
    this.options.outbox.save({ ...entry, status: 'failed', error: input.error ?? '运行在接收消息前结束，请重试发送' })
  }

  retry(input: AgentQueuedMessageControlInput, submit: (input: AgentSubmitOrEnqueueInput) => Promise<AgentSubmitOrEnqueueResult>): Promise<AgentSendOutboxRetryResult> {
    const key = `${input.sessionId}:${input.messageId}`
    const current = this.retrying.get(key)
    if (current) return current
    const retry = Promise.resolve().then(async (): Promise<AgentSendOutboxRetryResult> => {
      const ids = this.acknowledge(input.sessionId)
      if (ids.has(input.messageId)) return { disposition: 'accepted' }
      if (this.options.queuedIds(input.sessionId).has(input.messageId)) return { disposition: 'queued' }
      // 是否运行不能证明这条消息已被接收。稳定 ID 的统一提交门禁负责去重，
      // 主进程调度负责入队；不能因为另一轮尚未结束就阻止恢复失败消息。
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
