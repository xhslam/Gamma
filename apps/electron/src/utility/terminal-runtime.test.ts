import { describe, expect, test } from 'bun:test'
import * as shared from '@gamma/shared'
import { loadIsolatedModule } from '../test-utils/isolated-module'

interface FakePty {
  writes: string[]
  paused: number
  resumed: number
  killed: boolean
  failWrite: boolean
  emitData(data: string): void
  emitExit(exitCode: number): void
}
interface RuntimeEvent {
  type: string
  event?: { terminalId: string; sequence: number; data: string; exitCode: number }
}

function setup() {
  let bootstrap!: (event: { data: unknown; ports: unknown[] }) => void
  let receive!: (event: { data: unknown }) => void
  const sent: RuntimeEvent[] = []
  const ptys: FakePty[] = []
  const spawns: Array<{ file: string; args: string[] | string; options: { cwd: string; env: Record<string, string>; name: string; cols: number; rows: number } }> = []
  let agyMissing = false
  const timers = new Map<number, () => void>()
  let timerId = 0
  const port = { on: (_type: string, listener: typeof receive) => { receive = listener }, start() {}, close() {}, postMessage: (event: RuntimeEvent) => sent.push(event) }
  loadIsolatedModule(`${import.meta.dir}/terminal-runtime.ts`, {
    'node:fs': { existsSync: () => true, statSync: () => ({ isDirectory: () => true }) },
    'node:os': { homedir: () => '/project' },
    '@gamma/shared': shared,
    './terminal-shell-resolver': { resolveTerminalShell: () => ({ file: '/bin/zsh', args: ['-l'], title: 'zsh' }) },
    './agy-terminal-launch': {
      resolveAgyTerminalLaunch: () => {
        if (agyMissing) throw new Error('未找到 agy')
        return { file: '/trusted/agy', args: ['--dangerously-skip-permissions'], env: { PATH: '/trusted', TERM: 'xterm-256color' } }
      },
    },
    'node-pty': { spawn: (file: string, args: string[] | string, options: { cwd: string; env: Record<string, string>; name: string; cols: number; rows: number }) => {
      spawns.push({ file, args, options })
      let onData!: (data: string) => void
      let onExit!: (event: { exitCode: number }) => void
      const pty = {
        pid: ptys.length + 1, writes: [] as string[], paused: 0, resumed: 0, killed: false, failWrite: false,
        onData: (listener: typeof onData) => { onData = listener },
        onExit: (listener: typeof onExit) => { onExit = listener },
        write(data: string) { if (pty.failWrite) throw new Error('PTY 已关闭'); pty.writes.push(data) },
        resize() {}, pause() { pty.paused++ }, resume() { pty.resumed++ }, kill() { pty.killed = true },
        emitData: (data: string) => onData(data), emitExit: (exitCode: number) => onExit({ exitCode }),
      }
      ptys.push(pty)
      return pty
    } },
  }, {
    process: { env: {}, pid: 123, parentPort: { on: (_type: string, listener: typeof bootstrap) => { bootstrap = listener } } },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId },
    clearTimeout: (id: number) => timers.delete(id),
    console: { error() {} },
  })
  bootstrap({ data: { type: 'gamma-terminal-runtime-port' }, ports: [port] })
  const request = (data: unknown): void => receive({ data })
  const create = (terminalId = 't1') => request({ type: 'terminal.create', attemptId: ptys.length + 1, input: { terminalId, sessionId: 's1', cwd: '/project', cols: 80, rows: 24 } })
  const flush = (): void => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()) }
  return { sent, ptys, timers, request, create, flush, spawns, hideAgy: () => { agyMissing = true } }
}

describe('终端 PTY 输出及实例隔离', () => {
  test('Given 专用 AGY 入口 When 创建 PTY Then 直接启动 CLI 固定参数而非向 shell 注入命令', () => {
    const context = setup()
    context.request({ type: 'terminal.create', attemptId: 1, input: { terminalId: 'agy', sessionId: 'project-agy:a', cwd: '/project', cols: 100, rows: 30, strictCwd: true, launchAgy: true } })
    expect(context.spawns[0]).toEqual({ file: '/trusted/agy', args: ['--dangerously-skip-permissions'], options: { name: 'xterm-256color', cols: 100, rows: 30, cwd: '/project', env: { PATH: '/trusted', TERM: 'xterm-256color' } } })
    context.create('shell')
    expect(context.spawns[1]?.file).toBe('/bin/zsh')
  })
  test('Given AGY 未安装 When 创建项目终端 Then 返回明确错误且不回退成 shell', () => {
    const context = setup()
    context.hideAgy()
    context.request({ type: 'terminal.create', attemptId: 1, input: { terminalId: 'agy', sessionId: 'project-agy:a', cwd: '/project', cols: 80, rows: 24, strictCwd: true, launchAgy: true } })
    expect(context.spawns).toHaveLength(0)
    expect(context.sent.at(-1)).toMatchObject({ type: 'terminal.error', message: 'Error: 未找到 agy' })
  })
  test('Given 连续输出和退出 When 主进程逐批 ACK Then 输出按序完整排空后发送退出', () => {
    const context = setup()
    context.create()
    context.ptys[0]!.emitData('first')
    context.flush()
    context.ptys[0]!.emitData('second')
    context.ptys[0]!.emitExit(0)
    expect(context.sent.filter((event) => event.type === 'terminal.output')).toHaveLength(1)
    context.request({ type: 'terminal.ack-output', input: { terminalId: 't1', sequence: 1 } })
    expect(context.sent.filter((event) => event.type === 'terminal.output').map((event) => event.event?.data)).toEqual(['first', 'second'])
    expect(context.sent.filter((event) => event.type === 'terminal.exit')).toHaveLength(0)
    context.request({ type: 'terminal.ack-output', input: { terminalId: 't1', sequence: 2 } })
    expect(context.sent.at(-1)?.type).toBe('terminal.exit')
  })

  test('Given 大量输出包含终端查询 When 高水位暂停并继续 ACK Then pause/resume 背压且控制序列不被丢弃', () => {
    const context = setup()
    context.create()
    const data = 'x'.repeat(150_000) + '\x1b[6n'
    context.ptys[0]!.emitData(data)
    context.flush()
    expect(context.ptys[0]!.paused).toBe(1)
    for (let sequence = 1; sequence <= 3; sequence++) context.request({ type: 'terminal.ack-output', input: { terminalId: 't1', sequence } })
    expect(context.ptys[0]!.resumed).toBe(1)
    expect(context.sent.filter((event) => event.type === 'terminal.output').map((event) => event.event?.data).join('')).toBe(data)
  })

  test('Given kill 后同 ID 创建新 PTY When 旧实例迟到输出和退出 Then 不污染新实例或丢弃其输入', () => {
    const context = setup()
    context.create()
    const old = context.ptys[0]!
    context.request({ type: 'terminal.kill', terminalId: 't1' })
    context.create()
    old.emitData('stale output')
    old.emitExit(143)
    context.request({ type: 'terminal.kill', terminalId: 't1', attemptId: 1 })
    expect(context.ptys[1]!.killed).toBe(false)
    context.request({ type: 'terminal.input', input: { terminalId: 't1', data: 'echo alive\r' } })
    expect(context.ptys[1]!.writes).toEqual(['echo alive\r'])
    expect(context.sent.filter((event) => event.type === 'terminal.exit')).toHaveLength(0)
    expect(context.sent.filter((event) => event.type === 'terminal.output')).toHaveLength(0)
  })

  test('Given 一个 PTY 写入抛错 When 同时存在其他 PTY Then 仅故障终端退出而不崩溃整个运行时', () => {
    const context = setup()
    context.create('t1')
    context.create('t2')
    context.ptys[0]!.failWrite = true
    expect(() => context.request({ type: 'terminal.input', input: { terminalId: 't1', data: '\r' } })).not.toThrow()
    context.request({ type: 'terminal.input', input: { terminalId: 't2', data: 'alive' } })
    expect(context.ptys[1]!.writes).toEqual(['alive'])
    expect(context.sent.at(-1)?.event).toMatchObject({ terminalId: 't1', exitCode: -1 })
  })

  test('Given 输出 flush timer 待执行 When kill 或已退出 PTY 收到输入 Then timer 清理且不写入失效 PTY', () => {
    const context = setup()
    context.create()
    context.ptys[0]!.emitData('pending')
    context.request({ type: 'terminal.kill', terminalId: 't1' })
    expect(context.timers.size).toBe(0)
    context.create('t2')
    context.ptys[1]!.emitExit(0)
    context.request({ type: 'terminal.input', input: { terminalId: 't2', data: 'lost' } })
    expect(context.ptys[1]!.writes).toEqual([])
  })
})
