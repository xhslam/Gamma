#!/usr/bin/env bun
/** 显式选择的本机验收：生产Controller/原生helper；无CDP、JS输入替代或风险自动批准。 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { ComputerController, ComputerReobserveRequiredError, type ComputerExecuteResult, type ComputerHost } from '../src/main/lib/computer-controller'
import { ComputerNativeHost } from '../src/main/lib/computer-native-host'
import { ComputerAuthorizationManager } from '../src/main/lib/computer-authorization-manager'
import { configureComputerLogPath } from '../src/main/lib/computer-logger'
import { buildComputerAppKitFixture, createComputerLiveFixture, emptyComputerFixtureState, type ComputerFixtureState } from './computer-use-live-fixtures'

interface NativeObservation { width: number; height: number; display: { originX: number; originY: number; ptWidth: number; ptHeight: number } }
export function decodeComputerFixtureState(data: unknown): { source: string; state: ComputerFixtureState } | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  if (!['web', 'native-A', 'native-B'].includes(String(value.source)) || typeof value.text !== 'string' || typeof value.key !== 'string' || typeof value.moved !== 'boolean') return undefined
  const numbers = ['clicks', 'scrollY', 'selectionStart', 'selectionEnd', 'ticks', 'pid']
  if (!numbers.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && Number(value[key]) >= 0)) return undefined
  if (Number(value.selectionStart) > Number(value.selectionEnd) || Number(value.selectionEnd) > value.text.length) return undefined
  return { source: String(value.source), state: { clicks: Number(value.clicks), text: value.text, key: value.key, scrollY: Number(value.scrollY), selectionStart: Number(value.selectionStart), selectionEnd: Number(value.selectionEnd), ticks: Number(value.ticks), moved: value.moved, pid: Number(value.pid) } }
}

export async function verifyComputerUseLive(confirmed: boolean): Promise<void> {
  if (!confirmed || process.platform !== 'darwin') throw new Error('只允许在 macOS 显式传入 --confirm-local-test；会打开Chrome和原生夹具并执行真实鼠标键盘操作')
  const auth = new ComputerAuthorizationManager()
  if (!auth.getPreferences().shareObservations) throw new Error('用户尚未同意界面读取；请先在 Gamma 授权')
  const states: Record<string, ComputerFixtureState> = { web: emptyComputerFixtureState(), 'native-A': emptyComputerFixtureState(), 'native-B': emptyComputerFixtureState() }
  const state = states.web!
  const token = randomUUID()
  const fixture = createComputerLiveFixture(token)
  let expectedTitle = fixture.title
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === `/${token}`) return new Response(fixture.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (request.method === 'POST' && path === `/state/${token}`) {
      const decoded = decodeComputerFixtureState(await request.json())
      if (!decoded) return new Response('invalid fixture state', { status: 400 })
      Object.assign(states[decoded.source]!, decoded.state)
      return new Response('ok')
    }
    return new Response('not found', { status: 404 })
  } })
  const logPath = process.env.GAMMA_COMPUTER_LIVE_LOG
  if (logPath) configureComputerLogPath(logPath)
  const native = new ComputerNativeHost(() => ({ executable: resolve(import.meta.dir, '../resources/computer-use/gamma-computer-use-helper') }), { loggerEnvironment: () => ({ logPath: logPath ?? '/tmp/gamma-computer-live.log', version: 'live-production-acceptance' }) })
  let observation: NativeObservation | undefined
  const host: ComputerHost = {
    async call(method, params, timeout) { const result = await native.call(method, params, timeout); if (method === 'observe') observation = result as NativeObservation; return result },
    terminate: () => native.terminate(),
  }
  const controller = new ComputerController(host, { authManager: auth })
  native.onStopped(reason => controller.nativeStopped(reason))
  const binding = { sessionId: `live-${token}`, runId: token, channelId: 'local-acceptance', modelId: 'local-acceptance', routeIdentity: 'production-native-fixture' }
  controller.beginRun(binding, 'user', true)
  const execute = (params: Parameters<ComputerController['executeAutonomousAction']>[0]): Promise<ComputerExecuteResult> => controller.executeAutonomousAction(params, undefined, binding)
  function target(result: ComputerExecuteResult, name: string): { ref: string; coordinate: [number, number] } {
    if (!observation?.display || !result.image || !result.ax?.includes(expectedTitle)) throw new Error('当前窗口不是本轮指定夹具，停止')
    const line = result.ax.split('\n').find(item => item.includes(`title="${name}"`) || item.includes(`description="${name}"`))
    const ref = line?.match(/ref=([^ ]+)/)?.[1]
    const frame = line?.match(/frame=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/)?.slice(1).map(Number)
    if (!ref || !frame || frame.length !== 4) throw new Error(`没有实际观察到测试控件：${name}`)
    const display = observation.display
    return { ref, coordinate: [(frame[0]! + frame[2]! / 2 - display.originX) / display.ptWidth * result.image.width, (frame[1]! + frame[3]! / 2 - display.originY) / display.ptHeight * result.image.height] }
  }
  async function until(condition: () => boolean, message: string, timeout = 10_000): Promise<void> {
    const deadline = Date.now() + timeout
    while (!condition()) { if (controller.isRunStopped(binding.runId)) throw new Error('真实安全停止已触发，禁止自动恢复'); if (Date.now() >= deadline) throw new Error(message); await Bun.sleep(50) }
  }
  async function notDispatched(action: () => Promise<ComputerExecuteResult>): Promise<void> {
    let failure: unknown
    try { await action() } catch (error) { failure = error }
    if (!(failure instanceof ComputerReobserveRequiredError) || controller.isRunStopped(binding.runId)) throw new Error('旧目标没有按明确未投递契约拒绝，不能继续验收')
  }
  const evidence: string[] = []
  const record = (message: string): void => { evidence.push(message); console.log(`[live-acceptance] ${message}`) }
  let appKitProcess: ChildProcess | undefined
  let appKitLaunchError: Error | undefined
  try {
    // 仅打开隔离测试页；所有动作仍走生产输入链路。
    execFileSync('/usr/bin/open', ['-a', 'Google Chrome', `http://127.0.0.1:${server.port}/${token}`])
    await until(() => state.ticks > 0, '本地动态页未加载')
    let result = await execute({ action: 'get_app_state', app: 'Google Chrome' })
    let input = target(result, '中文输入验收框')
    const observedTick = state.ticks
    await until(() => state.ticks >= observedTick + 5, '动态页未持续更新')
    result = await execute({ action: 'click', app: 'Google Chrome', observationId: result.observationId, coordinate: input.coordinate })
    record('深层中文输入框已定位；延迟1秒以上且标题/内容持续变化后，完整mouse down/up仍只执行一次')
    result = await execute({ action: 'type_text', app: 'Google Chrome', text: '中文输入验收🚀' })
    await until(() => state.text === '中文输入验收🚀', '真实页面Unicode文本不一致')
    if (state.text !== '中文输入验收🚀') throw new Error('真实页面收到的Unicode文本不一致')
    result = await execute({ action: 'press_key', app: 'Google Chrome', key: 'ArrowLeft' })
    await until(() => state.key === 'ArrowLeft' && state.selectionStart === state.text.length - 2, 'ArrowLeft未保持emoji UTF16边界')
    result = await execute({ action: 'press_key', app: 'Google Chrome', key: 'cmd+shift+ArrowLeft' })
    await until(() => state.selectionEnd > state.selectionStart, '带Shift的选择快捷键未生效')
    result = await execute({ action: 'press_key', app: 'Google Chrome', key: 'cmd+a' })
    await until(() => state.selectionStart === 0 && state.selectionEnd === state.text.length, 'cmd+a未选中全部实际文本')
    result = await execute({ action: 'press_key', app: 'Google Chrome', key: 'Backspace' })
    await until(() => state.text === '', 'Backspace未删除实际选择区')
    result = await execute({ action: 'type_text', app: 'Google Chrome', text: '中文输入验收🚀' })
    await until(() => state.text === '中文输入验收🚀', '删除后重新输入不一致')
    record('中文/emoji、ArrowLeft、Shift选择、cmd+a与删除均由真实值和选择区验证')
    result = await execute({ action: 'press_key', app: 'Google Chrome', key: 'Tab' })
    await until(() => state.key === 'Tab', '真实页面未收到Tab焦点导航事件')
    const button = target(result, '单击验收按钮')
    result = await execute({ action: 'click', app: 'Google Chrome', observationId: result.observationId, coordinate: button.coordinate })
    await until(() => state.clicks === 1, '按钮未收到一次点击')
    if (state.clicks !== 1) throw new Error('鼠标事件没有构成且仅构成一次真实点击')
    record('Tab导航后坐标点击按钮，真实click计数恰好+1')
    const schedule = target(result, '安排目标移动')
    result = await execute({ action: 'click', app: 'Google Chrome', observationId: result.observationId, elementRef: schedule.ref })
    const oldResult = result, oldButton = target(result, '单击验收按钮')
    if (state.moved) throw new Error('移动早于旧观察，请增加夹具延迟，不能伪造失效证明')
    await until(() => state.moved, '延迟移动未发生', 12_000)
    await notDispatched(() => execute({ action: 'click', app: 'Google Chrome', observationId: oldResult.observationId, coordinate: oldButton.coordinate }))
    await notDispatched(() => execute({ action: 'click', app: 'Google Chrome', observationId: oldResult.observationId, elementRef: oldButton.ref }))
    if (state.clicks !== 1) throw new Error('失效目标仍产生了点击副作用')
    record('目标实际移动后旧坐标/旧引用均未投递，按钮计数未增加')
    result = await execute({ action: 'get_app_state', app: 'Google Chrome' })
    input = target(result, '中文输入验收框')
    result = await execute({ action: 'click', app: 'Google Chrome', observationId: result.observationId, elementRef: input.ref })
    const beforeScroll = state.scrollY
    result = await execute({ action: 'scroll', app: 'Google Chrome', observationId: result.observationId, delta_y: -300 })
    await until(() => state.scrollY > beforeScroll, '滚动已投递但真实页面未向下移动')
    if (state.scrollY <= beforeScroll) throw new Error('滚动事件已投递但页面未实际向下移动')
    result = await execute({ action: 'press_key', app: 'Google Chrome', key: 'cmd+l' })
    const focused = result.ax?.split('\n').find(line => line.includes('focused=true'))
    if (!focused || !/role="AX(?:TextField|ComboBox)"/.test(focused) || !focused.includes(`127.0.0.1:${server.port}/${token}`)) throw new Error('cmd+l后未验证到真实地址栏焦点')
    await execute({ action: 'press_key', app: 'Google Chrome', key: 'Escape' })
    record('真实scrollY增加；cmd+l确实聚焦本地页地址栏，未输入地址、导航或发送外部内容')

    const nativeFixture = buildComputerAppKitFixture(resolve(import.meta.dir, '../out/computer-use-fixtures'), token)
    appKitProcess = spawn(nativeFixture.executable, [token, `http://127.0.0.1:${server.port}/state/${token}`], { stdio: 'ignore' })
    appKitProcess.once('error', error => { appKitLaunchError = error })
    await until(() => { if (appKitLaunchError) throw appKitLaunchError; return states['native-A']!.pid > 0 && states['native-B']!.pid > 0 }, '原生AppKit夹具未就绪')
    expectedTitle = `${nativeFixture.title} [A]`
    result = await execute({ action: 'get_app_state' })
    input = target(result, '原生输入框A')
    result = await execute({ action: 'click', observationId: result.observationId, elementRef: input.ref })
    result = await execute({ action: 'type_text', text: '原生窗口A🚀' })
    await until(() => states['native-A']!.text === '原生窗口A🚀', '原生窗口A未收到准确Unicode')
    const priorA = result, priorAInput = target(result, '原生输入框A')
    const listed = await execute({ action: 'list_windows' })
    const windows = listed.windows?.filter(window => window.title.startsWith(nativeFixture.title)) ?? []
    const a = windows.find(window => window.title.endsWith('[A]')), b = windows.find(window => window.title.endsWith('[B]'))
    if (!a || !b || a.pid !== b.pid || a.windowId === b.windowId || JSON.stringify(a.bounds) !== JSON.stringify(b.bounds)) throw new Error('夹具没有建立真实同PID、同尺寸的双窗口')
    expectedTitle = `${nativeFixture.title} [B]`
    result = await execute({ action: 'focus_window', windowId: b.windowId })
    target(result, '原生输入框B')
    await notDispatched(() => execute({ action: 'click', observationId: priorA.observationId, elementRef: priorAInput.ref }))
    if (states['native-B']!.text !== '') throw new Error('A的旧引用写入了B')
    result = await execute({ action: 'get_app_state' })
    input = target(result, '原生输入框B')
    result = await execute({ action: 'click', observationId: result.observationId, elementRef: input.ref })
    result = await execute({ action: 'type_text', text: '原生窗口B🚀' })
    await until(() => states['native-B']!.text === '原生窗口B🚀', '原生窗口B未收到准确Unicode')
    const nativeButton = target(result, '原生计数按钮B')
    await execute({ action: 'click', observationId: result.observationId, elementRef: nativeButton.ref })
    await until(() => states['native-B']!.clicks === 1, '原生按钮没有恰好一次点击')
    if (states['native-A']!.text !== '原生窗口A🚀' || states['native-A']!.clicks !== 0) throw new Error('窗口B操作污染了窗口A')
    record('真实AppKit同PID/同几何双窗口：旧A引用不能作用于B，新观察下分别输入准确Unicode，原生按钮恰好点击一次')
    console.log(JSON.stringify({ liveAcceptance: true, evidence, fixtureOnly: true, productionController: true, productionNativeHelper: true, externalMessagesSent: false }, null, 2))
  } finally {
    await controller.finishRun(binding)
    await native.terminate()
    appKitProcess?.kill('SIGTERM') // 仅本脚本创建且持有的测试子进程，不查杀用户应用。
    server.stop(true)
  }
}
if (import.meta.main) await verifyComputerUseLive(process.argv.slice(2).length === 1 && process.argv[2] === '--confirm-local-test')
