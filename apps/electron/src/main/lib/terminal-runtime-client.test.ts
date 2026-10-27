import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import type { TerminalCreateInput, TerminalExitEvent, TerminalState } from '@proma/shared'
import { loadIsolatedModule } from '../../test-utils/isolated-module'
import { startUtilityProcessWithRetry } from './utility-process-startup'

type ClientModule = typeof import('./terminal-runtime-client')

function setup() {
  const ports: Array<{ sent: Array<{ type: string; input?: TerminalCreateInput }>; emit(data: unknown): void }> = []
  const processes: Array<{ emit(event: string, value: unknown): void }> = []
  const timers = new Map<number, () => void>()
  let timerId = 0
  const module = loadIsolatedModule<ClientModule>(`${import.meta.dir}/terminal-runtime-client.ts`, {
    'node:path': path,
    './utility-process-startup': { startUtilityProcessWithRetry },
    electron: {
      MessageChannelMain: class {
        port1 = {}
        port2: unknown
        constructor() {
          let receive!: (event: { data: unknown }) => void
          const port = {
            sent: [] as Array<{ type: string; input?: TerminalCreateInput }>,
            on: (_event: string, listener: typeof receive) => { receive = listener },
            start() {}, close() {},
            postMessage(message: { type: string; input?: TerminalCreateInput }) { port.sent.push(message) },
            emit: (data: unknown) => receive({ data }),
          }
          this.port2 = port
          ports.push(port)
        }
      },
      utilityProcess: { fork: () => {
        const listeners = new Map<string, (value: unknown) => void>()
        const process = {
          on: (event: string, listener: (value: unknown) => void) => listeners.set(event, listener),
          postMessage() {}, kill() {},
          emit: (event: string, value: unknown) => listeners.get(event)?.(value),
        }
        processes.push(process)
        return process
      } },
    },
  }, {
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId },
    clearTimeout: (id: number) => timers.delete(id),
    console: { error() {} },
  })
  const client = new module.TerminalRuntimeClient()
  const exits: TerminalExitEvent[] = []
  client.onExit((event) => exits.push(event))
  return { client, ports, processes, exits, timers }
}

const input: TerminalCreateInput = { terminalId: 't1', sessionId: 's1', cols: 80, rows: 24 }
const state: TerminalState = { terminalId: 't1', title: 'zsh', cwd: '/project', profile: 'default', pid: 42 }
async function settle(): Promise<void> { for (let index = 0; index < 6; index++) await Promise.resolve() }

async function create(context: ReturnType<typeof setup>): Promise<void> {
  const pending = context.client.create(input)
  await settle()
  context.ports[0]!.emit({ type: 'terminal.ready', pid: 1 })
  await settle()
  context.ports[0]!.emit({ type: 'terminal.created', attemptId: 1, state })
  await pending
}

describe('终端 runtime 生命周期', () => {
  test('Given port 已建立但尚未 ready When 并发创建 Then 所有调用等待握手且同 ID 只发送一次 create', async () => {
    const context = setup()
    const first = context.client.create(input)
    await settle()
    const second = context.client.create(input)
    await settle()
    expect(context.ports[0]!.sent).toEqual([])
    context.ports[0]!.emit({ type: 'terminal.ready', pid: 1 })
    await settle()
    expect(context.ports[0]!.sent.filter((message) => message.type === 'terminal.create')).toHaveLength(1)
    context.ports[0]!.emit({ type: 'terminal.created', attemptId: 1, state })
    await Promise.all([first, second])
    await context.client.stop()
  })

  test('Given 已运行终端 When utility 崩溃 Then 通知退出且后续输入拒绝，不启动空 runtime 静默丢弃', async () => {
    const context = setup()
    await create(context)
    context.processes[0]!.emit('exit', 1)
    expect(context.exits).toEqual([{ terminalId: 't1', exitCode: -1 }])
    await expect(context.client.input({ terminalId: 't1', data: '\r' })).rejects.toThrow('终端已退出')
    await expect(context.client.resize({ terminalId: 't1', cols: 100, rows: 30 })).rejects.toThrow('终端已退出')
    expect(context.processes).toHaveLength(1)
    context.processes[0]!.emit('error', 'late error')
    expect(context.exits).toHaveLength(1)
  })

  test('Given 启动等待 ready When 用户停止 Then 创建立即拒绝且所有启动 timer 清理', async () => {
    const context = setup()
    const pending = context.client.create(input)
    const rejected = pending.catch((error: unknown) => error)
    await settle()
    await context.client.stop()
    expect(await rejected).toHaveProperty('message', '终端运行时启动已取消')
    expect(context.timers.size).toBe(0)
  })

  test('Given runtime ready 但未返回创建结果 When 创建超时 Then 拒绝且迟到 created 不会泄漏 PTY', async () => {
    const context = setup()
    const pending = context.client.create(input)
    const rejected = pending.catch((error: unknown) => error)
    await settle()
    context.ports[0]!.emit({ type: 'terminal.ready', pid: 1 })
    await settle()
    const callbacks = [...context.timers.values()]
    context.timers.clear()
    callbacks.forEach((callback) => callback())
    expect(await rejected).toHaveProperty('message', '终端创建超时，请重试')
    context.ports[0]!.emit({ type: 'terminal.created', attemptId: 1, state })
    expect(context.ports[0]!.sent.filter((message) => message.type === 'terminal.kill')).toHaveLength(2)
    await expect(context.client.input({ terminalId: 't1', data: 'test' })).rejects.toThrow('终端已退出')
    await context.client.stop()
  })

  test('Given ready 后创建正在等待微任务 When 同时停止运行时 Then 立即拒绝且不遗留十秒创建 timer', async () => {
    const context = setup()
    await create(context)
    const pending = context.client.create({ ...input, terminalId: 't2' })
    const rejected = pending.catch((error: unknown) => error)
    await context.client.stop()
    expect(await rejected).toHaveProperty('message', '终端运行时已停止')
    expect(context.timers.size).toBe(0)
    expect(context.ports[0]!.sent.filter((message) => message.type === 'terminal.create')).toHaveLength(1)
  })

  test('Given 同 ID 创建超时后重试 When 旧 created 迟到 Then 不完成新请求或按 ID 杀掉新 PTY', async () => {
    const context = setup()
    const first = context.client.create(input).catch((error: unknown) => error)
    await settle()
    context.ports[0]!.emit({ type: 'terminal.ready', pid: 1 })
    await settle()
    const callbacks = [...context.timers.values()]
    context.timers.clear()
    callbacks.forEach((callback) => callback())
    await first
    const second = context.client.create(input)
    await settle()
    context.ports[0]!.emit({ type: 'terminal.created', attemptId: 1, state })
    context.ports[0]!.emit({ type: 'terminal.error', terminalId: 't1', attemptId: 1, message: '旧失败' })
    expect(context.timers.size).toBe(1)
    context.ports[0]!.emit({ type: 'terminal.created', attemptId: 2, state: { ...state, pid: 99 } })
    expect(await second).toMatchObject({ pid: 99 })
    context.ports[0]!.emit({ type: 'terminal.exit', attemptId: 1, event: { terminalId: 't1', exitCode: 143 } })
    expect(context.exits).toHaveLength(0)
    await expect(context.client.input({ terminalId: 't1', data: '\r' })).resolves.toBeUndefined()
    await context.client.stop()
  })

  test('Given 正常运行终端 When 输入、退出和关闭 Then 不额外 fork 且退出只收束当前实例', async () => {
    const context = setup()
    await create(context)
    await context.client.input({ terminalId: 't1', data: 'echo test\r' })
    expect(context.ports[0]!.sent.at(-1)?.type).toBe('terminal.input')
    context.ports[0]!.emit({ type: 'terminal.exit', attemptId: 1, event: { terminalId: 't1', exitCode: 0 } })
    await expect(context.client.input({ terminalId: 't1', data: '\r' })).rejects.toThrow('终端已退出')
    expect(context.processes).toHaveLength(1)
    await context.client.stop()
    expect(context.timers.size).toBe(0)
  })
})
