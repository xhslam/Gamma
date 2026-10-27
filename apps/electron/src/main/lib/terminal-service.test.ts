import { describe, expect, test } from 'bun:test'
import * as shared from '@proma/shared'
import type { TerminalCreateInput, TerminalExitEvent, TerminalOutputAck, TerminalOutputEvent, TerminalState } from '@proma/shared'
import { loadIsolatedModule } from '../../test-utils/isolated-module'
import * as outputBuffer from './terminal-output-buffer'

type Service = typeof import('./terminal-service')

function setup() {
  let outputListener!: (event: TerminalOutputEvent) => void
  let exitListener!: (event: TerminalExitEvent) => void
  const acknowledgements: TerminalOutputAck[] = []
  const sent: unknown[] = []
  const windowEvents = new Map<string, (...args: unknown[]) => void>()
  let windowAvailable = true
  let sendFails = false
  let creation: Promise<TerminalState> | undefined
  const service = loadIsolatedModule<Service>(`${import.meta.dir}/terminal-service.ts`, {
    'node:crypto': { randomUUID: () => 'agent-terminal' },
    '@proma/shared': shared,
    './terminal-output-buffer': outputBuffer,
    './terminal-agent-policy': { resolveAgentTerminalCwd: () => '/project' },
    './terminal-cwd': { requireTerminalCwd: () => '/project', resolveTerminalCwd: () => '/project' },
    './main-window-store': {
      getMainWindow: () => windowAvailable ? { webContents: { id: 7, on: (event: string, listener: (...args: unknown[]) => void) => windowEvents.set(event, listener), send: (...args: unknown[]) => {
        if (sendFails) throw new Error('窗口已销毁')
        sent.push(args)
      } } } : undefined,
    },
    './terminal-runtime-client': { terminalRuntimeClient: {
      onOutput: (listener: typeof outputListener) => { outputListener = listener },
      onExit: (listener: typeof exitListener) => { exitListener = listener },
      create: (input: TerminalCreateInput) => creation ?? Promise.resolve({ ...input, title: 'zsh', cwd: '/project', profile: 'default', pid: 42 }),
      acknowledgeOutput: (ack: TerminalOutputAck) => acknowledgements.push(ack),
      input: async () => {}, resize: async () => {}, kill: () => {}, stop: async () => {},
    } },
  })
  return {
    service, acknowledgements, sent,
    output: (sequence: number, data = `output-${sequence}`) => outputListener({ terminalId: 'test-terminal', sequence, data }),
    exit: () => exitListener({ terminalId: 'test-terminal', exitCode: 0 }),
    hideWindow: () => { windowAvailable = false },
    breakSend: () => { sendFails = true },
    loseRenderer: () => windowEvents.get('render-process-gone')?.(),
    delayCreate: (promise: Promise<TerminalState>) => { creation = promise },
  }
}

const input: TerminalCreateInput = { terminalId: 'test-terminal', sessionId: 'session', cols: 80, rows: 24 }

describe('终端主进程可靠输出接收', () => {
  test('Given 终端视图已卸载 When 连续接收输出 Then 主进程每批接收即 ACK 并保存完整快照', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.hideWindow()
    context.output(1)
    context.output(2)
    expect(context.acknowledgements.map((ack) => ack.sequence)).toEqual([1, 2])
    expect(context.service.getTerminalSnapshot(input.terminalId).output).toBe('output-1output-2')
  })

  test('Given 窗口发送失败 When 接收输出 Then 不阻塞 PTY 或丢失已接收数据', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.breakSend()
    expect(() => context.output(1)).not.toThrow()
    expect(context.acknowledgements).toHaveLength(1)
    expect(context.service.getTerminalSnapshot(input.terminalId).sequence).toBe(1)
  })

  test('Given 终端已关闭 When 收到迟到输出 Then 仍 ACK 但不重建缓冲', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.service.killTerminal(input.terminalId)
    context.output(1)
    expect(context.acknowledgements).toHaveLength(1)
    expect(() => context.service.getTerminalSnapshot(input.terminalId)).toThrow('终端不存在')
  })

  test('Given shell 在视图隐藏时退出 When 获取快照或再次绑定 Then 保留最终输出和退出状态且不重启 shell', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.output(1, 'final output')
    context.exit()
    const snapshot = context.service.getTerminalSnapshot(input.terminalId)
    expect(snapshot.output).toBe('final output')
    expect(snapshot.exitCode).toBe(0)
    await expect(context.service.createTerminal(input)).resolves.toMatchObject({ pid: 42 })
    await expect(context.service.writeTerminal({ terminalId: input.terminalId, data: '\r' })).rejects.toThrow('终端已退出')
    context.service.killTerminal(input.terminalId)
    expect(() => context.service.getTerminalSnapshot(input.terminalId)).toThrow('终端不存在')
  })

  test('Given renderer 回送重复或迟到 ACK When 已由主进程确认 Then 不再次干扰 runtime 输出链路', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.output(1)
    context.service.acknowledgeTerminalOutput({ terminalId: input.terminalId, sequence: 1 })
    context.service.acknowledgeTerminalOutput({ terminalId: input.terminalId, sequence: 1 })
    expect(context.acknowledgements).toHaveLength(1)
  })

  test('Given 会话拥有手动终端 When 删除会话清理终端 Then 通知 renderer 回收后台解析资源', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.service.closeTerminalsForSession('session')
    expect(context.sent).toContainEqual([shared.TERMINAL_IPC_CHANNELS.AGENT_CLOSE, { sessionId: 'session', terminalId: 'test-terminal' }])
    expect(() => context.service.getTerminalSnapshot(input.terminalId)).toThrow('终端不存在')
  })

  test('Given 持久解析器已绑定 When 收到输出 Then 解析完成才释放 credit，重复 ACK 不影响下一批', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.service.attachTerminalOutputConsumer(input.terminalId)
    context.output(1, '\x1b[6n')
    expect(context.acknowledgements).toHaveLength(0)
    context.service.acknowledgeTerminalOutput({ terminalId: input.terminalId, sequence: 1 })
    expect(context.acknowledgements).toHaveLength(1)
    context.output(2)
    context.service.acknowledgeTerminalOutput({ terminalId: input.terminalId, sequence: 1 })
    expect(context.acknowledgements).toHaveLength(1)
    context.service.acknowledgeTerminalOutput({ terminalId: input.terminalId, sequence: 2 })
    expect(context.acknowledgements.map((ack) => ack.sequence)).toEqual([1, 2])
  })

  test('Given 正等待解析 credit When renderer 崩溃 Then 释放未确认输出且后续转为主进程可靠接收', async () => {
    const context = setup()
    await context.service.createTerminal(input)
    context.service.attachTerminalOutputConsumer(input.terminalId)
    context.output(1)
    context.loseRenderer()
    context.output(2)
    expect(context.acknowledgements.map((ack) => ack.sequence)).toEqual([1, 2])
  })

  test('Given 首批输出早于创建完成 When 接收 Then 接收并 ACK 而不依赖 renderer 的创建状态', async () => {
    const context = setup()
    let resolve!: (state: TerminalState) => void
    context.delayCreate(new Promise((done) => { resolve = done }))
    const creating = context.service.createTerminal(input)
    context.output(1)
    expect(context.acknowledgements).toHaveLength(1)
    resolve({ ...input, title: 'zsh', cwd: '/project', profile: 'default', pid: 42 })
    await creating
    expect(context.service.getTerminalSnapshot(input.terminalId).output).toBe('output-1')
  })
})
