import type { TerminalOutputEvent } from '@gamma/shared'

interface TerminalOutputStreamOptions {
  write: (data: string, callback: () => void) => void
  onError: (error: unknown) => void
  onParsed?: (sequence: number) => void
  maxPendingChars?: number
}

interface OutputChunk {
  data: string
  replay?: boolean
  sequence?: number
  complete?: () => void
}

/** 持久解析器逐批返回 credit；有界串行队列防止快照重复，异常时显式失败而非丢弃协议。 */
export class TerminalOutputStream {
  private readonly maxPendingChars: number
  private pendingEvents: TerminalOutputEvent[] = []
  private chunks: OutputChunk[] = []
  private restoring = true
  private writing = false
  private disposed = false
  private lastAcceptedSequence = 0
  private queuedChars = 0
  private replaying = false

  constructor(private readonly options: TerminalOutputStreamOptions) {
    this.maxPendingChars = options.maxPendingChars ?? 1_000_000
  }

  get isReplaying(): boolean { return this.replaying }
  get pendingChars(): number { return this.queuedChars }

  push(event: TerminalOutputEvent): void {
    if (this.disposed || event.sequence <= this.lastAcceptedSequence) return
    this.lastAcceptedSequence = event.sequence
    if (this.queuedChars + event.data.length > this.maxPendingChars) {
      this.dispose()
      this.options.onError(new Error('终端解析队列超过容量，请关闭此标签后新建终端'))
      return
    }
    const data = event.data
    if (data.length === 0) return
    this.queuedChars += data.length
    if (this.restoring) this.pendingEvents.push({ ...event, data })
    else {
      this.chunks.push({ data, sequence: event.sequence })
      this.drain()
    }
  }

  restore(output: string, sequence: number, complete?: () => void): void {
    if (this.disposed || !this.restoring) return
    this.restoring = false
    this.lastAcceptedSequence = Math.max(sequence, this.lastAcceptedSequence)
    // 快照已包含的事件不能再次解析（尤其不能再次生成设备查询响应）。
    const liveEvents = this.pendingEvents.filter((event) => event.sequence > sequence)
    this.pendingEvents = []
    this.queuedChars = output.length + liveEvents.reduce((total, event) => total + event.data.length, 0)
    this.chunks = [{ data: output, replay: true, sequence, complete }, ...liveEvents.map((event) => ({ data: event.data, sequence: event.sequence }))]
    this.drain()
  }

  writeStatus(data: string): void {
    if (this.disposed) return
    this.chunks.push({ data })
    this.queuedChars += data.length
    this.drain()
  }

  dispose(): void {
    this.disposed = true
    this.chunks = []
    this.pendingEvents = []
    this.queuedChars = 0
  }

  private drain(): void {
    if (this.disposed || this.restoring || this.writing) return
    const chunk = this.chunks.shift()
    if (!chunk) return
    this.queuedChars -= chunk.data.length
    this.writing = true
    this.replaying = chunk.replay === true
    try {
      this.options.write(chunk.data, () => {
        if (this.disposed) return
        this.writing = false
        this.replaying = false
        if (chunk.sequence !== undefined && chunk.sequence > 0) this.options.onParsed?.(chunk.sequence)
        chunk.complete?.()
        this.drain()
      })
    } catch (error) {
      this.writing = false
      this.replaying = false
      this.dispose()
      this.options.onError(error)
    }
  }
}
