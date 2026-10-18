import type { WebContents } from 'electron'
import type {
  AgentDeferredQueueMessageInput,
  AgentMoveQueuedMessageInput,
  AgentQueuedMessageSnapshot,
  AgentQueuedMessageControlInput,
  AgentQueuedMessageStatus,
} from '@gamma/shared'

type DispatchedQueueRunInput = AgentDeferredQueueMessageInput & { runGeneration: number }

interface QueueEntry {
  input: AgentDeferredQueueMessageInput
  queuedAt: number
}

export interface AgentQueueCoordinatorOptions {
  isActive: (sessionId: string) => boolean
  getWebContents: (sessionId: string) => WebContents | null
  startRun: (input: DispatchedQueueRunInput, webContents: WebContents) => Promise<void>
  sendStarted: (webContents: WebContents, status: AgentQueuedMessageStatus) => void
  /** 运行身份由生命周期所有者分配，队列只负责调度。 */
  reserveRunGeneration: (sessionId: string) => number
}

/** 主进程持有 deferred queue；renderer 只保留展示投影。 */
export class AgentQueueCoordinator {
  private readonly queues = new Map<string, QueueEntry[]>()
  private readonly dispatching = new Map<string, string>()
  private readonly paused = new Map<string, 'stopped' | 'background'>()
  /** 本轮已同步处理停止意图，迟到的终态不能再次覆盖之后的新提交。 */
  private readonly requestedStops = new Set<string>()

  constructor(private readonly options: AgentQueueCoordinatorOptions) {}

  enqueue(input: AgentDeferredQueueMessageInput): 'started' | 'queued' {
    if (this.dispatching.get(input.sessionId) === input.queueMessageId) return 'started'
    const queue = this.queues.get(input.sessionId) ?? []
    if (queue.some((entry) => entry.input.queueMessageId === input.queueMessageId)) {
      const runStarted = this.dispatching.get(input.sessionId) === input.queueMessageId
      return runStarted ? 'started' : 'queued'
    }
    queue.push({ input, queuedAt: Date.now() })
    this.queues.set(input.sessionId, queue)
    // 明确的新提交可恢复用户停止后保留的队列，窗口重绑不能代替用户意图。
    if (this.paused.get(input.sessionId) === 'stopped') this.paused.delete(input.sessionId)
    this.tryDispatch(input.sessionId)
    const runStarted = this.dispatching.get(input.sessionId) === input.queueMessageId
    return runStarted ? 'started' : 'queued'
  }

  cancel(input: AgentQueuedMessageControlInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue) return false
    const index = queue.findIndex((entry) => entry.input.queueMessageId === input.messageId)
    if (index < 0) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.queues.delete(input.sessionId)
    return true
  }

  move(input: AgentMoveQueuedMessageInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue || input.sourceId === input.targetId) return false
    const sourceIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.sourceId)
    const targetIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    if (sourceIndex < 0 || targetIndex < 0) return false
    const [source] = queue.splice(sourceIndex, 1)
    if (!source) return false
    const adjustedTarget = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    const insertIndex = input.placement === 'after' ? adjustedTarget + 1 : adjustedTarget
    queue.splice(insertIndex, 0, source)
    return true
  }

  requestStop(sessionId: string): void {
    this.paused.set(sessionId, 'stopped')
    if (this.dispatching.has(sessionId) || this.options.isActive(sessionId)) this.requestedStops.add(sessionId)
  }

  onRunComplete(
    sessionId: string,
    _queueMessageId: string | undefined,
    backgroundTasksPending: boolean,
    stoppedByUser: boolean,
  ): void {
    // 完成事件先于 runtime/computer use 清理。dispatching 只能由 startRun Promise
    // 的收尾释放，否则下一轮会与旧执行共享权限、工具通道及桌面控制资源。
    const stopWasRequested = this.requestedStops.delete(sessionId)
    if (stoppedByUser) {
      if (!stopWasRequested) this.paused.set(sessionId, 'stopped')
    } else if (backgroundTasksPending && this.paused.get(sessionId) !== 'stopped') this.paused.set(sessionId, 'background')
    if (this.dispatching.has(sessionId)) return
    this.tryDispatch(sessionId)
  }

  /** 清理期发生的 stop 可能没有后续终态；不能把该标记遗留给下一轮。 */
  onRunSettled(sessionId: string): void {
    this.requestedStops.delete(sessionId)
  }

  onBackgroundTaskComplete(sessionId: string): void {
    if (this.paused.get(sessionId) === 'background') this.paused.delete(sessionId)
    this.tryDispatch(sessionId)
  }

  /** Renderer/webContents 重新可用后唤醒等待中的队列。tryDispatch 自身负责去重 active/dispatching。 */
  onTargetAvailable(sessionId: string): void {
    this.tryDispatch(sessionId)
  }

  snapshot(sessionId: string): AgentQueuedMessageSnapshot[] {
    return (this.queues.get(sessionId) ?? []).map((entry) => ({ input: { ...entry.input }, queuedAt: entry.queuedAt }))
  }

  isDispatching(sessionId: string): boolean {
    return this.dispatching.has(sessionId)
  }

  isDispatchingMessage(sessionId: string, messageId: string): boolean {
    return this.dispatching.get(sessionId) === messageId
  }

  hasPending(sessionId: string): boolean {
    return this.dispatching.has(sessionId) || (this.queues.get(sessionId)?.length ?? 0) > 0
  }

  clear(sessionId: string): void {
    this.queues.delete(sessionId)
    this.dispatching.delete(sessionId)
    this.paused.delete(sessionId)
    this.requestedStops.delete(sessionId)
  }

  private tryDispatch(sessionId: string): void {
    if (this.paused.has(sessionId) || this.dispatching.has(sessionId) || this.options.isActive(sessionId)) return
    const queue = this.queues.get(sessionId)
    const entry = queue?.shift()
    if (!entry) return
    if (queue?.length === 0) this.queues.delete(sessionId)

    const messageId = entry.input.queueMessageId
    this.dispatching.set(sessionId, messageId)
    try {
      const webContents = this.options.getWebContents(sessionId)
      if (!webContents || webContents.isDestroyed()) {
        queue?.unshift(entry)
        if (queue) this.queues.set(sessionId, queue)
        this.dispatching.delete(sessionId)
        return
      }
      const runGeneration = this.options.reserveRunGeneration(sessionId)
      // 有请求时间戳时原样回传，renderer 在接收事件丢失时仍可用快照确认接管。
      const startedAt = entry.input.startedAt ?? Date.now()
      this.options.sendStarted(webContents, {
        sessionId,
        messageId,
        status: 'started',
        userMessage: entry.input.userMessage,
        rawUserMessage: entry.input.rawUserMessage,
        startedAt,
        runGeneration,
      })
      void Promise.resolve()
        .then(() => this.options.startRun({ ...entry.input, startedAt, runGeneration, userMessageUuid: messageId }, webContents))
        .then(
          () => this.finishDispatch(sessionId, messageId),
          () => this.finishDispatch(sessionId, messageId),
        )
    } catch {
      // 窗口解析、身份分配或 started 投递均可能失败；恢复原位后等待下一次唤醒。
      queue?.unshift(entry)
      if (queue) this.queues.set(sessionId, queue)
      this.dispatching.delete(sessionId)
      return
    }
  }

  private finishDispatch(sessionId: string, messageId: string): void {
    if (this.dispatching.get(sessionId) === messageId) {
      this.onRunSettled(sessionId)
      this.dispatching.delete(sessionId)
      this.tryDispatch(sessionId)
    }
  }
}
