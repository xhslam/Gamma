import { join } from 'node:path'
import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron'
import { startUtilityProcessWithRetry } from './utility-process-startup'
import type {
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalInput,
  TerminalOutputAck,
  TerminalOutputEvent,
  TerminalResizeInput,
  TerminalState,
} from '@gamma/shared'

type RuntimePort = Pick<MessagePortMain, 'close' | 'postMessage' | 'start'> & {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

type PendingCreate = {
  attemptId: number
  promise: Promise<TerminalState>
  resolve: (state: TerminalState) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type RuntimeTerminalCreateInput = TerminalCreateInput & {
  strictCwd?: boolean
  launchAgy?: boolean
}

type RuntimeMessage =
  | { type: 'terminal.ready'; pid: number }
  | { type: 'terminal.created'; attemptId: number; state: TerminalState }
  | { type: 'terminal.output'; attemptId: number; event: TerminalOutputEvent }
  | { type: 'terminal.exit'; attemptId: number; event: TerminalExitEvent }
  | { type: 'terminal.error'; terminalId: string; attemptId: number; message: string }

const STARTUP_TIMEOUT_MS = 10_000

/**
 * 一个 utility process 管理全部本地 PTY：与 Agent runtime 隔离，又不会为每个 Tab
 * 创建一个 Node 进程。Renderer 始终经由此 client 接收已批处理的输出。
 */
export class TerminalRuntimeClient {
  private runtimeProcess: UtilityProcess | undefined
  private port: RuntimePort | undefined
  private starting: Promise<void> | undefined
  private generation = 0
  private cancelStartup: ((error: Error) => void) | undefined
  private readonly activeTerminals = new Map<string, number>()
  private nextCreateAttemptId = 1
  private readonly pendingCreates = new Map<string, PendingCreate>()
  private readonly outputListeners = new Set<(event: TerminalOutputEvent) => void>()
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>()

  onOutput(listener: (event: TerminalOutputEvent) => void): () => void {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  onExit(listener: (event: TerminalExitEvent) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async create(input: TerminalCreateInput, options: { strictCwd?: boolean; launchAgy?: boolean } = {}): Promise<TerminalState> {
    const startup = this.start()
    const generation = this.generation
    await startup
    const port = this.port
    if (!port || generation !== this.generation) throw new Error('终端运行时已停止')
    const pending = this.pendingCreates.get(input.terminalId)
    if (pending) return pending.promise

    let resolveCreate!: (state: TerminalState) => void
    let rejectCreate!: (reason: Error) => void
    const promise = new Promise<TerminalState>((resolve, reject) => {
      resolveCreate = resolve
      rejectCreate = reject
    })
    const attemptId = this.nextCreateAttemptId++
    const timeout = setTimeout(() => {
      this.pendingCreates.delete(input.terminalId)
      this.kill(input.terminalId, attemptId)
      rejectCreate(new Error('终端创建超时，请重试'))
    }, STARTUP_TIMEOUT_MS)
    this.pendingCreates.set(input.terminalId, { attemptId, promise, resolve: resolveCreate, reject: rejectCreate, timeout })
    const runtimeInput: RuntimeTerminalCreateInput = { ...input, strictCwd: options.strictCwd === true, launchAgy: options.launchAgy === true }
    try {
      port.postMessage({ type: 'terminal.create', input: runtimeInput, attemptId })
    } catch (error) {
      this.pendingCreates.delete(input.terminalId)
      clearTimeout(timeout)
      rejectCreate(error instanceof Error ? error : new Error(String(error)))
    }
    return promise
  }

  async input(input: TerminalInput): Promise<void> {
    const port = this.requireActiveTerminal(input.terminalId)
    port.postMessage({ type: 'terminal.input', input })
  }

  async resize(input: TerminalResizeInput): Promise<void> {
    const port = this.requireActiveTerminal(input.terminalId)
    port.postMessage({ type: 'terminal.resize', input })
  }

  private requireActiveTerminal(terminalId: string): RuntimePort {
    if (!this.port || !this.activeTerminals.has(terminalId)) throw new Error('终端已退出或运行时不可用，请新建终端')
    return this.port
  }

  acknowledgeOutput(input: TerminalOutputAck): void {
    this.port?.postMessage({ type: 'terminal.ack-output', input })
  }

  kill(terminalId: string, attemptId?: number): void {
    if (attemptId === undefined || this.activeTerminals.get(terminalId) === attemptId) this.activeTerminals.delete(terminalId)
    this.port?.postMessage({ type: 'terminal.kill', terminalId, ...(attemptId === undefined ? {} : { attemptId }) })
  }

  async stop(): Promise<void> {
    this.generation++
    this.cancelStartup?.(new Error('终端运行时启动已取消'))
    this.cancelStartup = undefined
    this.activeTerminals.clear()
    const port = this.port
    const runtimeProcess = this.runtimeProcess
    this.port = undefined
    if (port) {
      port.postMessage({ type: 'terminal.shutdown' })
      port.close()
    }
    try { runtimeProcess?.kill() } catch { /* utility process may already be exiting */ }
    this.runtimeProcess = undefined
    this.starting = undefined
    this.rejectPendingCreates(new Error('终端运行时已停止'))
  }

  private async start(): Promise<void> {
    // port 在握手完成前已建立，必须优先等待 ready barrier。
    if (this.starting) return this.starting
    if (this.port) return

    const starting = this.startRuntime(++this.generation)
    this.starting = starting
    try {
      await starting
    } finally {
      if (this.starting === starting) this.starting = undefined
    }
  }

  private async startRuntime(generation: number): Promise<void> {
    const entryPath = join(__dirname, 'terminal-runtime.cjs')
    const isCurrentStartup = () => generation === this.generation
    const runtimeProcess = await startUtilityProcessWithRetry(
      () => utilityProcess.fork(entryPath, [], { serviceName: 'Gamma Terminal Runtime' }),
      { shouldContinue: isCurrentStartup },
    )
    if (!isCurrentStartup()) {
      try { runtimeProcess.kill() } catch { /* utility process may already be exiting */ }
      throw new Error('终端运行时启动已取消')
    }
    this.runtimeProcess = runtimeProcess

    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannelMain()
      const port = channel.port2 as unknown as RuntimePort
      const isCurrentRuntime = () =>
        generation === this.generation
        && this.runtimeProcess === runtimeProcess
        && this.port === port
      const fail = (error: Error): void => {
        clearTimeout(timeout)
        if (this.cancelStartup === fail) this.cancelStartup = undefined
        if (isCurrentRuntime()) this.handleRuntimeFailure(error, runtimeProcess, port)
        reject(error)
      }
      const timeout = setTimeout(() => {
        if (!isCurrentRuntime()) return
        fail(new Error('终端运行时启动超时'))
      }, STARTUP_TIMEOUT_MS)
      const ready = (): void => {
        clearTimeout(timeout)
        if (this.cancelStartup === fail) this.cancelStartup = undefined
        resolve()
      }
      this.cancelStartup = fail
      this.port = port
      port.on('message', ({ data }) => {
        if (!isCurrentRuntime()) return
        const message = data as RuntimeMessage
        if (message?.type === 'terminal.ready') ready()
        this.handleMessage(message)
      })
      port.start()
      runtimeProcess.on('error', (type) => fail(new Error(`终端运行时错误：${type}`)))
      const processEvents = runtimeProcess as unknown as { on(event: 'exit', listener: (code: number) => void): void }
      processEvents.on('exit', (code) => fail(new Error(`终端运行时已退出（${code}）`)))
      runtimeProcess.postMessage({ type: 'gamma-terminal-runtime-port' }, [channel.port1])
    })
  }

  private handleMessage(message: RuntimeMessage): void {
    if (message.type === 'terminal.created') {
      const pending = this.pendingCreates.get(message.state.terminalId)
      if (!pending || pending.attemptId !== message.attemptId) {
        this.kill(message.state.terminalId, message.attemptId)
        return
      }
      this.pendingCreates.delete(message.state.terminalId)
      clearTimeout(pending.timeout)
      this.activeTerminals.set(message.state.terminalId, message.attemptId)
      pending.resolve(message.state)
    } else if (message.type === 'terminal.error') {
      const pending = this.pendingCreates.get(message.terminalId)
      if (pending?.attemptId === message.attemptId) {
        this.pendingCreates.delete(message.terminalId)
        clearTimeout(pending.timeout)
        pending.reject(new Error(message.message))
      }
    } else if (message.type === 'terminal.output') {
      if (this.activeTerminals.get(message.event.terminalId) !== message.attemptId) return
      for (const listener of this.outputListeners) listener(message.event)
    } else if (message.type === 'terminal.exit') {
      if (this.activeTerminals.get(message.event.terminalId) !== message.attemptId) return
      this.activeTerminals.delete(message.event.terminalId)
      for (const listener of this.exitListeners) listener(message.event)
    }
  }

  private handleRuntimeFailure(
    error: Error,
    runtimeProcess: UtilityProcess | undefined = this.runtimeProcess,
    port: RuntimePort | undefined = this.port,
  ): void {
    port?.close()
    if (this.port === port) this.port = undefined
    try { runtimeProcess?.kill() } catch { /* utility process may already be exiting */ }
    if (this.runtimeProcess === runtimeProcess) this.runtimeProcess = undefined
    this.rejectPendingCreates(error)
    const activeTerminalIds = [...this.activeTerminals.keys()]
    this.activeTerminals.clear()
    for (const terminalId of activeTerminalIds) {
      for (const listener of this.exitListeners) listener({ terminalId, exitCode: -1 })
    }
    console.error('[TerminalRuntime] 终端运行时失败：', error)
  }

  private rejectPendingCreates(error: Error): void {
    for (const pending of this.pendingCreates.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingCreates.clear()
  }
}

export const terminalRuntimeClient = new TerminalRuntimeClient()
