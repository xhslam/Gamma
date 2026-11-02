#!/usr/bin/env bun
/** 显式本机验收：只对本脚本自有 AppKit 夹具使用生产 agent-desktop 语义操作，不再调用旧 Swift 输入协议。 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { ComputerController } from '../src/main/lib/computer-controller'
import { AgentDesktopHost } from '../src/main/lib/agent-desktop-host'
import type { AgentDesktopInput } from '../src/main/lib/agent-desktop-protocol'
import { ComputerAuthorizationManager } from '../src/main/lib/computer-authorization-manager'
import { buildComputerAppKitFixture, emptyComputerFixtureState, type ComputerFixtureState } from './computer-use-live-fixtures'

export function decodeComputerFixtureState(data: unknown): { source: string; state: ComputerFixtureState } | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  if (!['web', 'native-A', 'native-B'].includes(String(value.source)) || typeof value.text !== 'string' || typeof value.key !== 'string' || typeof value.moved !== 'boolean') return undefined
  const numbers = ['clicks', 'scrollY', 'selectionStart', 'selectionEnd', 'ticks', 'pid']
  if (!numbers.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && Number(value[key]) >= 0)) return undefined
  if (Number(value.selectionStart) > Number(value.selectionEnd) || Number(value.selectionEnd) > value.text.length) return undefined
  return { source: String(value.source), state: { clicks: Number(value.clicks), text: value.text, key: value.key, scrollY: Number(value.scrollY), selectionStart: Number(value.selectionStart), selectionEnd: Number(value.selectionEnd), ticks: Number(value.ticks), moved: value.moved, pid: Number(value.pid) } }
}


/** 仅从原生返回的真实树中找唯一控件，不猜 ref 或坐标。 */
export function findComputerFixtureRef(tree: unknown, name: string): string {
  const refs = new Set<string>()
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if ((node.name === name || node.description === name) && typeof node.ref_id === 'string') refs.add(node.ref_id)
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(tree)
  if (refs.size !== 1) throw new Error('未在原生观察中唯一定位夹具控件')
  return [...refs][0]!
}

export async function verifyComputerUseLive(confirmed: boolean): Promise<void> {
  if (!confirmed || process.platform !== 'darwin') throw new Error('只允许在 macOS 显式传入 --confirm-local-test；会打开自有 AppKit 夹具并执行真实语义输入与点击')
  const auth = new ComputerAuthorizationManager()
  if (!auth.getPreferences().shareObservations) throw new Error('用户尚未同意界面读取；请先在 Gamma 授权')
  // CLI 无法承载 Electron 本地授权弹窗，不自动批准或改写设置。
  if (auth.getPreferences().riskPolicy !== 'relaxed') throw new Error('请在 Gamma 中显式选择宽松策略后运行本地夹具；本脚本不会自动批准授权')
  const token = randomUUID()
  const states: Record<string, ComputerFixtureState> = { 'native-A': emptyComputerFixtureState(), 'native-B': emptyComputerFixtureState() }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== `/state/${token}`) return new Response('not found', { status: 404 })
    const decoded = decodeComputerFixtureState(await request.json())
    if (!decoded || !states[decoded.source]) return new Response('invalid fixture state', { status: 400 })
    Object.assign(states[decoded.source]!, decoded.state)
    return new Response('ok')
  } })
  const native = new AgentDesktopHost(() => ({ executable: resolve(import.meta.dir, '../resources/agent-desktop/agent-desktop') }))
  const controller = new ComputerController(native, { authManager: auth })
  const binding = { sessionId: `live-${token}`, runId: token, channelId: 'local-acceptance', modelId: 'local-acceptance' }
  controller.beginRun(binding, 'user', true)
  let appKitProcess: ChildProcess | undefined
  const execute = async (input: AgentDesktopInput): Promise<unknown> => {
    const result = await controller.execute(binding, input)
    if (!result.ok) throw new Error(`原生验收命令失败：${result.error?.code ?? 'unknown'}；不得重放`)
    return result.data
  }
  const until = async (condition: () => boolean): Promise<void> => {
    const deadline = Date.now() + 10_000
    while (!condition()) {
      if (controller.isRunStopped(binding.runId)) throw new Error('桌面运行已停止，不得恢复或重放')
      if (Date.now() >= deadline) throw new Error('夹具真实业务状态未达到预期')
      await Bun.sleep(50)
    }
  }
  try {
    const fixture = buildComputerAppKitFixture(resolve(import.meta.dir, '../out/computer-use-fixtures'), token)
    appKitProcess = spawn(fixture.executable, [token, `http://127.0.0.1:${server.port}/state/${token}`], { stdio: 'ignore' })
    let launchError: Error | undefined
    appKitProcess.once('error', error => { launchError = error })
    await until(() => { if (launchError) throw launchError; return states['native-A']!.pid === appKitProcess?.pid && states['native-B']!.pid === appKitProcess?.pid })
    const listed = await execute({ command: 'list-windows', app: fixture.bundleId })
    if (!Array.isArray(listed)) throw new Error('原生窗口库存不符合契约')
    for (const name of ['A', 'B']) {
      const matches = listed.filter((window: unknown): window is Record<string, unknown> => !!window && typeof window === 'object')
        .filter(window => window.pid === appKitProcess?.pid && window.title === `${fixture.title} [${name}]` && typeof window.id === 'string')
      if (matches.length !== 1) throw new Error('无法唯一确认自有夹具窗口')
      const windowId = String(matches[0]!.id)
      const snapshot = async (): Promise<Record<string, unknown>> => {
        const data = await execute({ command: 'snapshot', app: fixture.bundleId, windowId })
        if (!data || typeof data !== 'object' || !('window' in data) || !data.window || typeof data.window !== 'object'
          || !('title' in data.window) || data.window.title !== `${fixture.title} [${name}]`) throw new Error('实际观察不是自有夹具窗口')
        return data as Record<string, unknown>
      }
      let observed = await snapshot()
      const inputRef = findComputerFixtureRef(observed.tree, `原生输入框${name}`)
      const expected = `原生窗口${name}🚀`
      await execute({ command: 'set-value', ref: inputRef, value: expected })
      await until(() => states[`native-${name}`]!.text === expected)
      observed = await snapshot()
      const buttonRef = findComputerFixtureRef(observed.tree, `原生计数按钮${name}`)
      await execute({ command: 'click', ref: buttonRef })
      await until(() => states[`native-${name}`]!.clicks === 1)
    }
    if (states['native-A']!.text !== '原生窗口A🚀' || states['native-B']!.text !== '原生窗口B🚀'
      || states['native-A']!.clicks !== 1 || states['native-B']!.clicks !== 1) throw new Error('双窗口真实业务结果不一致')
    console.log(JSON.stringify({ liveAcceptance: true, fixtureOnly: true, backend: 'agent-desktop', semanticInput: true,
      unicodeAndWindowIsolation: true, headedKeyboardMouseTested: false, externalMessagesSent: false }, null, 2))
  } finally {
    try { await controller.finishRun(binding) } finally {
      try { await native.terminate() } finally {
        appKitProcess?.kill('SIGTERM') // 仅本脚本创建且持有的夹具进程。
        server.stop(true)
      }
    }
  }
}
if (import.meta.main) await verifyComputerUseLive(process.argv.slice(2).length === 1 && process.argv[2] === '--confirm-local-test')
