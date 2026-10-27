import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawn, type IPty } from 'node-pty'
import {
  isTerminalProfile,
  type TerminalCreateInput,
  type TerminalExitEvent,
  type TerminalInput,
  type TerminalOutputAck,
  type TerminalOutputEvent,
  type TerminalResizeInput,
  type TerminalState,
} from '@proma/shared'
import { resolveTerminalShell } from './terminal-shell-resolver'

type MessagePortLike = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
  start(): void
  close(): void
}

type ParentPortLike = {
  on(event: 'message', listener: (event: { data: unknown; ports?: MessagePortLike[] }) => void): void
  start?: () => void
}

type RuntimeTerminalCreateInput = TerminalCreateInput & {
  strictCwd?: boolean
}

type RuntimeRequest =
  | { type: 'terminal.create'; attemptId: number; input: RuntimeTerminalCreateInput }
  | { type: 'terminal.input'; input: TerminalInput }
  | { type: 'terminal.resize'; input: TerminalResizeInput }
  | { type: 'terminal.kill'; terminalId: string; attemptId?: number }
  | { type: 'terminal.ack-output'; input: TerminalOutputAck }
  | { type: 'terminal.shutdown' }

type InFlightOutput = {
  sequence: number
  data: string
}

type ManagedTerminal = {
  attemptId: number
  pty: IPty
  state: TerminalState
  output: string
  paused: boolean
  nextSequence: number
  inFlight: InFlightOutput | undefined
  flushTimer: ReturnType<typeof setTimeout> | undefined
  exitEvent: TerminalExitEvent | undefined
}

const OUTPUT_HIGH_WATERMARK_CHARS = 64 * 1024
const OUTPUT_LOW_WATERMARK_CHARS = 32 * 1024
const OUTPUT_FLUSH_DELAY_MS = 16
const terminals = new Map<string, ManagedTerminal>()
const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort
let runtimePort: MessagePortLike | undefined

if (!parentPort) {
  console.error('[TerminalRuntime] Electron parentPort is unavailable')
  process.exit(1)
}

parentPort.on('message', (event) => {
  const value = event?.data as Record<string, unknown> | undefined
  const transfer = value?.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : value
  if (!transfer || transfer.type !== 'proma-terminal-runtime-port') return
  const port = event.ports?.[0] ?? value?.port as MessagePortLike | undefined
  if (!port) {
    console.error('[TerminalRuntime] invalid MessagePort bootstrap message')
    process.exit(1)
  }
  runtimePort?.close()
  runtimePort = port
  port.on('message', (message) => handleRequest(message.data))
  port.start()
  port.postMessage({ type: 'terminal.ready', pid: process.pid })
})
parentPort.start?.()

function handleRequest(raw: unknown): void {
  if (!isRuntimeRequest(raw)) return
  switch (raw.type) {
    case 'terminal.create':
      createTerminal(raw.input, raw.attemptId)
      return
    case 'terminal.input':
      operateTerminal(raw.input.terminalId, (terminal) => terminal.pty.write(raw.input.data))
      return
    case 'terminal.resize':
      operateTerminal(raw.input.terminalId, (terminal) => terminal.pty.resize(normalizeDimension(raw.input.cols), normalizeDimension(raw.input.rows)))
      return
    case 'terminal.kill':
      destroyTerminal(raw.terminalId, raw.attemptId)
      return
    case 'terminal.ack-output':
      acknowledgeOutput(raw.input)
      return
    case 'terminal.shutdown':
      for (const terminalId of terminals.keys()) destroyTerminal(terminalId)
      runtimePort?.postMessage({ type: 'terminal.stopped' })
      return
  }
}

function createTerminal(input: RuntimeTerminalCreateInput, attemptId: number): void {
  const existing = terminals.get(input.terminalId)
  if (existing) {
    runtimePort?.postMessage({ type: 'terminal.created', attemptId, state: existing.state })
    return
  }
  const profile = isTerminalProfile(input.profile) ? input.profile : 'default'
  try {
    const shell = resolveTerminalShell(profile)
    const cwd = getSafeCwd(input.cwd, input.strictCwd === true)
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: normalizeDimension(input.cols),
      rows: normalizeDimension(input.rows),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    const state: TerminalState = {
      terminalId: input.terminalId,
      title: shell.title,
      cwd,
      profile,
      pid: pty.pid,
    }
    const managed: ManagedTerminal = {
      attemptId,
      pty,
      state,
      output: '',
      paused: false,
      nextSequence: 1,
      inFlight: undefined,
      flushTimer: undefined,
      exitEvent: undefined,
    }
    terminals.set(input.terminalId, managed)
    runtimePort?.postMessage({ type: 'terminal.created', attemptId, state })
    pty.onData((data) => {
      if (terminals.get(input.terminalId) === managed) enqueueOutput(input.terminalId, data)
    })
    pty.onExit(({ exitCode, signal }) => {
      const event: TerminalExitEvent = { terminalId: input.terminalId, exitCode, ...(signal === undefined ? {} : { signal }) }
      // kill 后同 ID 已创建新 PTY 时，旧实例的迟到事件不能修改新实例。
      if (terminals.get(input.terminalId) !== managed) return
      managed.exitEvent = event
      flushOutput(input.terminalId)
      emitExitWhenDrained(input.terminalId)
    })
  } catch (error) {
    runtimePort?.postMessage({
      type: 'terminal.error',
      attemptId,
      terminalId: input.terminalId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function enqueueOutput(terminalId: string, data: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal) return
  terminal.output += data
  if (!terminal.paused && terminal.output.length >= OUTPUT_HIGH_WATERMARK_CHARS) {
    // 暂停 PTY 读取，让内核背压限制生产者；不能任意截断 TUI 控制序列。
    terminal.paused = true
    terminal.pty.pause()
  }
  if (!terminal.flushTimer) {
    terminal.flushTimer = setTimeout(() => flushOutput(terminalId), OUTPUT_FLUSH_DELAY_MS)
  }
}

function flushOutput(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal) return
  if (terminal.flushTimer) clearTimeout(terminal.flushTimer)
  terminal.flushTimer = undefined
  if (terminal.inFlight) return
  if (!terminal.output) return
  const data = terminal.output.slice(0, OUTPUT_HIGH_WATERMARK_CHARS)
  terminal.output = terminal.output.slice(data.length)
  const sequence = terminal.nextSequence
  terminal.nextSequence += 1
  terminal.inFlight = { sequence, data }
  const event: TerminalOutputEvent = { terminalId, sequence, data }
  runtimePort?.postMessage({ type: 'terminal.output', attemptId: terminal.attemptId, event })
}

function acknowledgeOutput(input: TerminalOutputAck): void {
  const terminal = terminals.get(input.terminalId)
  if (!terminal?.inFlight || terminal.inFlight.sequence !== input.sequence) return
  terminal.inFlight = undefined
  flushOutput(input.terminalId)
  if (terminal.paused && !terminal.exitEvent && terminal.output.length < OUTPUT_LOW_WATERMARK_CHARS) {
    terminal.paused = false
    terminal.pty.resume()
  }
  emitExitWhenDrained(input.terminalId)
}

function emitExitWhenDrained(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal?.exitEvent || terminal.inFlight || terminal.output) return
  terminals.delete(terminalId)
  runtimePort?.postMessage({ type: 'terminal.exit', attemptId: terminal.attemptId, event: terminal.exitEvent })
}

function destroyTerminal(terminalId: string, attemptId?: number): void {
  const terminal = terminals.get(terminalId)
  if (!terminal || (attemptId !== undefined && terminal.attemptId !== attemptId)) return
  if (terminal.flushTimer) clearTimeout(terminal.flushTimer)
  terminal.flushTimer = undefined
  terminals.delete(terminalId)
  try {
    terminal.pty.kill()
  } catch {
    // 进程已退出时 node-pty 可能抛错；终端生命周期在此收束即可。
  }
}

function operateTerminal(terminalId: string, operation: (terminal: ManagedTerminal) => void): void {
  const terminal = terminals.get(terminalId)
  if (!terminal || terminal.exitEvent) return
  try {
    operation(terminal)
  } catch (error) {
    console.error('[TerminalRuntime] 终端操作失败：', error)
    destroyTerminal(terminalId)
    runtimePort?.postMessage({ type: 'terminal.exit', attemptId: terminal.attemptId, event: { terminalId, exitCode: -1 } })
  }
}

function getSafeCwd(cwd: string | undefined, strict: boolean): string {
  if (isDirectory(cwd)) return cwd
  if (strict) throw new Error('终端工作目录不存在或不是目录')
  return homedir()
}

function isDirectory(path: string | undefined): path is string {
  if (!path || !existsSync(path)) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as { type?: unknown }
  return request.type === 'terminal.create' || request.type === 'terminal.input' || request.type === 'terminal.resize' || request.type === 'terminal.kill' || request.type === 'terminal.ack-output' || request.type === 'terminal.shutdown'
}
