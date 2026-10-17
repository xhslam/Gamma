import { randomUUID } from 'node:crypto'
import type {
  ComputerAction, ComputerActionReceipt, ComputerArmInput, ComputerBinding,
  ComputerObservationDescriptor, ComputerPermission, ComputerPrivateObservation, ComputerState, ComputerTarget,
  ComputerAXContext,
} from '@gamma/shared'
import { computerAuthorizationManager, ComputerAuthorizationManager } from './computer-authorization-manager'
import { evaluateComputerRisk } from './computer-risk-analyzer'

export interface ComputerHost {
  call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
  /** 只有确认旧进程退出才 resolve；不以取消 RPC 代替退出屏障。 */
  terminate(): Promise<void>
}

export interface ComputerExecuteParams {
  action: string
  coordinate?: [number, number]
  x?: number
  y?: number
  text?: string
  key?: string
  app?: string
  appName?: string
  app_name?: string
  duration?: number
  delta_y?: number
  deltaY?: number
  scroll_amount?: number
  start_coordinate?: [number, number]
  startX?: number
  startY?: number
}

export interface ComputerExecuteResult {
  message: string
  image: {
    data: string
    mimeType: string
    width: number
    height: number
  }
}
interface RunContext { binding: ComputerBinding; source: string; vision: boolean; consentId: string; updatedAt: number }
interface Lease {
  leaseId: string; epoch: number; context: RunContext; binding?: ComputerBinding
  target?: ComputerTarget; expiresAt: number
}
interface StoredObservation { descriptor: ComputerObservationDescriptor; nativeId: string; data: ComputerPrivateObservation }
const COMPUTER_TOOLS = new Set(['ComputerStatus', 'ComputerObserve', 'ComputerAct', 'ComputerStop', 'computer'])
const PURE_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])
const TTL = 30_000
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const sameBinding = (a: ComputerBinding, b: ComputerBinding): boolean => a.sessionId === b.sessionId && a.runId === b.runId && a.channelId === b.channelId && a.modelId === b.modelId && a.routeIdentity === b.routeIdentity
function boundedText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function parseTarget(value: unknown): ComputerTarget {
  if (!isRecord(value) || !Number.isSafeInteger(value.windowId) || Number(value.windowId) < 0 || !Number.isSafeInteger(value.pid) || Number(value.pid) < 0
    || !boundedText(value.processIdentity, 256) || typeof value.bundleId !== 'string' || value.bundleId.length > 256
    || typeof value.title !== 'string' || value.title.length > 4096 || !isRecord(value.bounds)) throw new Error('原生目标身份无效')
  const bounds = value.bounds
  if (!['x', 'y', 'width', 'height'].every(key => typeof bounds[key] === 'number' && Number.isFinite(bounds[key])) || Number(bounds.width) <= 0 || Number(bounds.height) <= 0) throw new Error('原生窗口布局无效')
  return { windowId: Number(value.windowId), pid: Number(value.pid), processIdentity: value.processIdentity, bundleId: value.bundleId, title: value.title,
    bounds: { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) } }
}
function parseObservation(value: unknown, observationId: string, epoch: number): ComputerPrivateObservation {
  if (!isRecord(value) || !boundedText(value.observationId, 128) || !isRecord(value.image) || typeof value.ax !== 'string' || Buffer.byteLength(value.ax) > 32_768) throw new Error('原生观察协议无效')
  const image = value.image
  if (image.mimeType !== 'image/png' || typeof image.data !== 'string' || image.data.length > 12_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error('原生图像协议无效')
  const png = Buffer.from(image.data, 'base64')
  if (png.length < 24 || png.length > 8 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('原生观察不是有效 PNG')
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 1920 || height > 1920 || image.width !== width || image.height !== height) throw new Error('原生图像尺寸不一致或过大')
  return { observationId, epoch, image: { data: image.data, mimeType: 'image/png', width, height }, ax: value.ax }
}
export function validateComputerAction(action: ComputerAction, descriptor: ComputerObservationDescriptor): void {
  if (!action || !['click', 'type', 'key', 'scroll', 'axPress', 'axSetValue'].includes(action.kind) || action.observationId !== descriptor.observationId) throw new Error('动作或观察绑定无效')
  const fields: Record<ComputerAction['kind'], string[]> = {
    click: ['x', 'y'], type: ['text'], key: ['key'], scroll: ['x', 'y', 'deltaY'], axPress: ['elementRef'], axSetValue: ['elementRef', 'text'],
  }
  const allowed = new Set(['kind', 'observationId', ...fields[action.kind]])
  if (Object.keys(action).some(key => !allowed.has(key))) throw new Error('动作包含未允许参数')
  if (action.kind === 'click' || action.kind === 'scroll') {
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || Number(action.x) < 0 || Number(action.y) < 0 || Number(action.x) >= descriptor.width || Number(action.y) >= descriptor.height) throw new Error('坐标不在本次观察图像内')
  }
  if (action.kind === 'scroll' && (!Number.isSafeInteger(action.deltaY) || Math.abs(Number(action.deltaY)) > 600 || action.deltaY === 0)) throw new Error('滚动范围无效')
  if ((action.kind === 'type' || action.kind === 'axSetValue') && (typeof action.text !== 'string' || action.text.length > 256 || (action.kind === 'type' && action.text.length === 0) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(action.text))) throw new Error('输入文本无效或过长')
  if (action.kind === 'key' && !['Enter', 'Escape', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(action.key ?? '')) throw new Error('快捷键不在白名单')
  if ((action.kind === 'axPress' || action.kind === 'axSetValue') && !boundedText(action.elementRef, 128)) throw new Error('AX 引用无效')
}

/** 纯主进程策略；不导入 Electron、浏览器控制器或 Pi，便于真实可执行的拒绝路径测试。 */
export class ComputerController {
  private state: ComputerState
  private contexts = new Map<string, RunContext>()
  private activeRuns = new Map<string, ComputerBinding>()
  private lease?: Lease
  private epoch = 0
  private observation?: StoredObservation
  private busy = false
  private reservations = new Map<string, string>()
  private permissionInFlight = false
  private expiryTimer?: ReturnType<typeof setTimeout>
  private stopping?: Promise<ComputerState>
  private stopFailed = false
  private listeners = new Set<(state: ComputerState) => void>()
  private revocations = new Set<{ binding: ComputerBinding; listener: () => void }>()
  private readonly now: () => number
  readonly authManager: ComputerAuthorizationManager
  constructor(private readonly host: ComputerHost, options: { supported?: boolean; now?: () => number; authManager?: ComputerAuthorizationManager } = {}) {
    const supported = options.supported ?? process.platform === 'darwin'
    this.state = { supported, phase: supported ? 'disabled' : 'unsupported' }
    this.now = options.now ?? Date.now
    this.authManager = options.authManager ?? computerAuthorizationManager
  }
  onState(listener: (state: ComputerState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  /** 同步撤销对应query/provider；清空缓存不能撤回已提取的请求副本。 */
  onRevoked(binding: ComputerBinding, listener: () => void): () => void {
    this.requireLease(binding)
    const entry = { binding: { ...binding }, listener }
    this.revocations.add(entry)
    return () => { this.revocations.delete(entry) }
  }
  getState(sessionId?: string): ComputerState {
    const state = structuredClone(this.state)
    if (!this.lease && sessionId) {
      const context = this.contexts.get(sessionId)
      if (context) Object.assign(state, { sessionId, channelId: context.binding.channelId, modelId: context.binding.modelId, consentId: context.consentId })
      else Object.assign(state, { sessionId, channelId: undefined, modelId: undefined, consentId: undefined })
    }
    return state
  }
  private publish(update: Partial<ComputerState>): void {
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) { try { listener(this.getState()) } catch { /* UI 故障不能打断撤权。 */ } }
  }
  /** 在凭据/环境预检的第一个 await 之前占位，覆盖尚未创建 Pi query 的运行。 */
  reserveRun(sessionId: string): () => void {
    if ([...this.reservations.values()].includes(sessionId) || this.permissionInFlight || this.stopping || this.stopFailed || (this.lease && (this.lease.context.binding.sessionId !== sessionId || this.lease.binding))) throw new Error('已有桌面控制或系统授权操作，不能并发启动其他运行')
    const id = randomUUID()
    this.reservations.set(id, sessionId)
    return () => { this.reservations.delete(id) }
  }
  beginRun(binding: ComputerBinding, source: string, vision: boolean): boolean {
    if (this.activeRuns.has(binding.sessionId)) throw new Error('会话已有在途运行')
    if (this.stopping || this.stopFailed || this.permissionInFlight) throw new Error('旧原生进程尚未证明停止或系统授权正在进行')
    const lease = this.lease
    if (lease) {
      if (lease.binding || lease.context.binding.sessionId !== binding.sessionId || source !== 'user' || !vision
        || lease.context.binding.channelId !== binding.channelId || lease.context.binding.modelId !== binding.modelId || lease.context.binding.routeIdentity !== binding.routeIdentity || this.now() >= lease.expiresAt) {
        void this.stop('渠道、模型或运行来源变化，桌面授权已撤销')
        throw new Error('桌面模式仅属于已授权会话的下一轮；请重新确认渠道/模型')
      }
      lease.binding = { ...binding }
    }
    this.contexts.set(binding.sessionId, { binding: { ...binding }, source, vision, consentId: randomUUID(), updatedAt: this.now() })
    this.activeRuns.set(binding.sessionId, { ...binding })
    if (!lease) this.publish({ sessionId: binding.sessionId, channelId: binding.channelId, modelId: binding.modelId, consentId: this.contexts.get(binding.sessionId)?.consentId })
    return !!lease
  }
  async finishRun(binding: ComputerBinding): Promise<void> {
    const current = this.activeRuns.get(binding.sessionId)
    if (current && sameBinding(current, binding)) this.activeRuns.delete(binding.sessionId)
    if (this.lease && ((this.lease.binding && sameBinding(this.lease.binding, binding)) || (!this.lease.binding && this.lease.context.binding.sessionId === binding.sessionId))) await this.stop('本轮运行结束，单次桌面授权已撤销')
  }
  async arm(input: ComputerArmInput): Promise<ComputerState> {
    if (!this.state.supported) throw new Error('原生桌面控制需要 macOS 14.2+')
    if (!input || typeof input.sessionId !== 'string' || input.shareObservations !== true) throw new Error('必须由本地用户同意所选窗口观察外发')
    if (this.lease || this.stopping || this.stopFailed || this.permissionInFlight || this.reservations.size > 0 || this.activeRuns.size > 0) throw new Error('请先停止所有 Agent 运行和已有桌面控制，再启用下一轮')
    const context = this.contexts.get(input.sessionId)
    if (!context || context.source !== 'user' || !context.vision || context.consentId !== input.consentId || this.now() - context.updatedAt > 300_000) throw new Error('渠道/模型确认已失效、视觉能力未知或不是前台用户会话，请刷新后重新确认')
    this.epoch += 1
    this.contexts.set(input.sessionId, { ...context, consentId: randomUUID() })
    this.lease = { leaseId: randomUUID(), epoch: this.epoch, context, expiresAt: this.now() + 30 * 60_000 }
    this.observation = undefined
    this.expiryTimer = setTimeout(() => { void this.stop('桌面授权已到期') }, 30 * 60_000)
    this.expiryTimer.unref()
    this.publish({ phase: 'armed', resumeRequired: false, sessionId: input.sessionId, channelId: context.binding.channelId, modelId: context.binding.modelId,
      consentId: undefined, target: undefined, pendingAction: undefined, message: '仅授权下一轮；首次观察时由原生窗口选择目标。每个写动作还需本地确认。' })
    return this.getState()
  }
  async stopForSession(sessionId: string, reason: string): Promise<void> {
    if (this.isExclusive() && this.state.sessionId === sessionId) await this.stop(reason)
  }
  isExclusive(): boolean { return this.state.phase === 'armed' || !!this.stopping || this.stopFailed }
  isDesktopRun(binding: ComputerBinding): boolean { return !!this.lease?.binding && sameBinding(this.lease.binding, binding) }
  assertExternalExecutionAllowed(): void { if (this.isExclusive()) throw new Error('桌面模式与通用执行互斥；请先停止桌面控制') }
  assertTool(binding: ComputerBinding, toolName: string): void {
    if (toolName === 'computer') return
    if (COMPUTER_TOOLS.has(toolName)) {
      if (toolName === 'ComputerStatus') return
      if (toolName === 'ComputerStop' && !this.isExclusive()) return
      this.requireLease(binding)
      return
    }
    if (this.isExclusive() && (!this.isDesktopRun(binding) || !PURE_TOOLS.has(toolName))) throw new Error('桌面模式仅允许 Computer 工具与进度任务；通用执行/浏览器/MCP/文件工具不可绕行')
  }
  private requireLease(binding: ComputerBinding): Lease {
    const lease = this.lease
    if (!lease?.binding || !sameBinding(lease.binding, binding) || this.stopping || this.now() >= lease.expiresAt) throw new Error('没有当前运行有效的本地桌面授权')
    return lease
  }
  private verify(lease: Lease): void { if (this.lease !== lease || this.stopping || this.now() >= lease.expiresAt) throw new Error('桌面授权已失效，迟到结果已丢弃') }
  async observe(binding: ComputerBinding, signal?: AbortSignal): Promise<ComputerObservationDescriptor> {
    const lease = this.requireLease(binding)
    return this.operation(signal, async () => {
      if (!lease.target) {
        this.publish({ phase: 'selecting', message: '请在原生窗口中选择唯一目标；取消会撤销本轮授权。' })
        const selected = await this.host.call('select', { leaseId: lease.leaseId, epoch: lease.epoch, deadline: lease.expiresAt }, 120_000)
        this.verify(lease)
        if (!isRecord(selected)) throw new Error('原生目标选择响应无效')
        lease.target = parseTarget(selected.target)
        this.publish({ target: lease.target, phase: 'active' })
      }
      const raw = await this.host.call('observe', { leaseId: lease.leaseId, epoch: lease.epoch }, 15_000)
      this.verify(lease)
      const observationId = randomUUID()
      const data = parseObservation(raw, observationId, lease.epoch)
      if (!isRecord(raw) || raw.epoch !== lease.epoch) throw new Error('原生观察代际不一致')
      const descriptor = { observationId, epoch: lease.epoch, width: data.image.width, height: data.image.height, createdAt: this.now() }
      this.observation = { descriptor, nativeId: String(raw.observationId), data }
      this.publish({ phase: 'active', message: '观察只保存在内存；写动作会显示原生本地确认。' })
      return { ...descriptor }
    })
  }
  getPrivateObservations(binding: ComputerBinding): ComputerPrivateObservation[] {
    if (!this.isDesktopRun(binding) || !this.observation || this.stopping || !this.lease || this.now() >= this.lease.expiresAt || this.now() - this.observation.descriptor.createdAt > TTL) return []
    return [structuredClone(this.observation.data)]
  }
  async act(binding: ComputerBinding, action: ComputerAction, signal?: AbortSignal): Promise<ComputerActionReceipt> {
    const lease = this.requireLease(binding)
    const stored = this.observation
    if (!stored || this.now() - stored.descriptor.createdAt > TTL) throw new Error('观察缺失、已消费或已过期，请重新观察')
    validateComputerAction(action, stored.descriptor)
    const immutable = structuredClone(action)
    return this.operation(signal, async () => {
      this.verify(lease)
      const actionId = randomUUID()
      this.observation = undefined // 在任何异步批准/投递前单次消费，不以失败为由自动重试。
      this.publish({ pendingAction: { actionId, kind: immutable.kind }, message: '等待原生逐动作确认；停止后迟到确认无效。' })
      try {
        const result = await this.host.call('perform', { leaseId: lease.leaseId, epoch: lease.epoch, actionId,
          action: { ...immutable, observationId: stored.nativeId } }, 120_000)
        this.verify(lease)
        if (!isRecord(result) || result.actionId !== actionId || !['dispatched-unverified', 'outcome-unknown', 'rejected'].includes(String(result.outcome))) throw new Error('原生动作回执无效')
        const outcome = result.outcome as ComputerActionReceipt['outcome']
        return { actionId, outcome, message: outcome === 'dispatched-unverified' ? '动作已投递，业务结果未验证；请重新观察，不要自动重放。' : outcome === 'outcome-unknown' ? '副作用未知，禁止自动重试。' : '动作未获批准或执行条件不满足。' }
      } catch {
        if (this.lease === lease) await this.stop('动作中断，副作用可能未知；禁止自动重试', 'paused')
        return { actionId, outcome: 'outcome-unknown', message: '动作中断，不能判断是否已产生副作用；禁止自动重试。' }
      } finally { this.publish({ pendingAction: undefined }) }
    })
  }

  /**
   * 确保原生桌面控制会话就绪。
   * 采用全桌面控制模式，无需手动进入桌面模式或选择单一窗口。
   */
  async ensureDesktopSession(): Promise<Lease> {
    if (!this.state.supported) throw new Error('原生桌面控制需要 macOS 14.2+')
    if (this.stopping || this.stopFailed) throw new Error('旧原生进程尚未证明停止，请重试停止')
    if (this.state.resumeRequired) throw new Error('桌面操作已暂停，请在侧边栏点击“重新启用”后再试')
    if (this.busy || this.permissionInFlight) throw new Error('已有原生操作在途，请等待完成')
    if (this.lease && this.now() < this.lease.expiresAt) {
      return this.lease
    }
    if (this.lease) {
      await this.stop('桌面授权已到期', 'paused')
      throw new Error('桌面授权已到期，请在侧边栏重新启用')
    }
    this.epoch += 1
    const leaseId = randomUUID()
    const expiresAt = this.now() + 30 * 60_000
    const lease: Lease = {
      leaseId,
      epoch: this.epoch,
      context: {
        binding: { sessionId: 'autonomous', runId: 'autonomous', channelId: 'autonomous', modelId: 'autonomous', routeIdentity: 'autonomous' },
        source: 'user',
        vision: true,
        consentId: randomUUID(),
        updatedAt: this.now(),
      },
      expiresAt,
    }
    this.lease = lease
    this.publish({ phase: 'selecting', message: '正在初始化桌面控制...' })
    const selected = await this.operation(undefined, async () => {
      return this.host.call('select', { leaseId, epoch: this.epoch, deadline: expiresAt }, 120_000)
    })
    this.verify(lease)
    if (!isRecord(selected)) throw new Error('原生桌面初始化响应无效')
    lease.target = parseTarget(selected.target)
    this.publish({ target: lease.target, phase: 'active', message: '桌面控制已就绪' })
    return lease
  }

  /** 获取当前屏幕截图。若无活动会话则自动连接。 */
  async screenshot(signal?: AbortSignal): Promise<{ data: string; mimeType: string; width: number; height: number }> {
    const lease = await this.ensureDesktopSession()
    return this.operation(signal, async () => {
      const raw = await this.host.call('observe', { leaseId: lease.leaseId, epoch: lease.epoch }, 15_000)
      this.verify(lease)
      const observationId = randomUUID()
      const data = parseObservation(raw, observationId, lease.epoch)
      const descriptor = { observationId, epoch: lease.epoch, width: data.image.width, height: data.image.height, createdAt: this.now() }
      this.observation = { descriptor, nativeId: String((raw as Record<string, unknown>).observationId), data }
      return data.image
    })
  }

  /**
   * 执行自主桌面动作，并在执行后自动截取最新屏幕状态返回。
   * 支持 Anthropic 风格的 action 规范与坐标/按键参数。
   */
  async executeAutonomousAction(params: ComputerExecuteParams, signal?: AbortSignal): Promise<ComputerExecuteResult> {
    const lease = await this.ensureDesktopSession()
    const rawAction = (params.action ?? '').trim().toLowerCase()
    let actionKind = rawAction
    if (actionKind === 'left_click') actionKind = 'click'
    else if (actionKind === 'move') actionKind = 'mouse_move'
    else if (actionKind === 'openapp' || actionKind === 'launch') actionKind = 'open_app'
    else if (actionKind === 'sleep') actionKind = 'wait'
    else if (actionKind === 'left_click_drag') actionKind = 'drag'

    if (actionKind === 'screenshot') {
      const img = await this.screenshot(signal)
      return { message: '屏幕截图已捕获', image: img }
    }

    // 若当前没有可用观察或已过期，先获取一次建立安全门观察快照
    if (!this.observation || this.now() - this.observation.descriptor.createdAt > TTL) {
      await this.screenshot(signal)
    }

    const stored = this.observation!
    const actionId = randomUUID()

    // 坐标规范化：数组优先，或独立 x, y
    let x = Array.isArray(params.coordinate) && params.coordinate.length >= 2 ? params.coordinate[0] : params.x
    let y = Array.isArray(params.coordinate) && params.coordinate.length >= 2 ? params.coordinate[1] : params.y
    let startX = Array.isArray(params.start_coordinate) && params.start_coordinate.length >= 2 ? params.start_coordinate[0] : params.startX
    let startY = Array.isArray(params.start_coordinate) && params.start_coordinate.length >= 2 ? params.start_coordinate[1] : params.startY

    // 安全边界截断：确保落入当前截图尺寸内
    if (x !== undefined && Number.isFinite(x)) x = Math.max(0, Math.min(stored.descriptor.width - 1, Math.round(x)))
    if (y !== undefined && Number.isFinite(y)) y = Math.max(0, Math.min(stored.descriptor.height - 1, Math.round(y)))
    if (startX !== undefined && Number.isFinite(startX)) startX = Math.max(0, Math.min(stored.descriptor.width - 1, Math.round(startX)))
    if (startY !== undefined && Number.isFinite(startY)) startY = Math.max(0, Math.min(stored.descriptor.height - 1, Math.round(startY)))

    const text = params.text
    const key = params.key ?? params.text
    const app = params.app ?? params.appName ?? params.app_name ?? params.text
    const duration = params.duration ?? 2
    const deltaY = params.delta_y ?? params.deltaY ?? params.scroll_amount ?? -300

    // 1. 应用级授权检查（按应用授权：本次允许 / 总是允许 / 拒绝）
    const targetAppName = app ?? lease.target?.title
    const targetBundleId = app ? undefined : lease.target?.bundleId
    if (targetAppName && actionKind !== 'screenshot' && actionKind !== 'wait') {
      await this.authManager.ensureAppAuthorized(targetAppName, targetBundleId)
    }

    // 2. 结合 AX 上下文进行高低风险分级判定（严格 / 标准 / 宽松）
    const axContext: ComputerAXContext = {
      appName: targetAppName,
      bundleId: targetBundleId,
      title: stored.data.ax,
    }
    const policy = this.authManager.getPreferences().riskPolicy
    const risk = evaluateComputerRisk(params, axContext, policy)
    if (risk.requiresConfirmation) {
      this.publish({ message: `等待高风险操作确认: ${risk.reason}` })
      const confirmed = await this.authManager.confirmRiskAction({
        requestId: actionId,
        title: '高风险操作确认',
        reason: risk.reason,
        actionKind,
        targetApp: targetAppName,
        authMethod: risk.authMethod,
      })
      if (!confirmed) {
        throw new Error(`用户取消了高风险操作: ${risk.reason}`)
      }
    }

    const actionPayload: Record<string, unknown> = {
      kind: actionKind,
      observationId: stored.nativeId,
      ...(x !== undefined && { x }),
      ...(y !== undefined && { y }),
      ...(startX !== undefined && { startX }),
      ...(startY !== undefined && { startY }),
      ...(text !== undefined && { text }),
      ...(key !== undefined && { key }),
      ...(app !== undefined && { appName: app }),
      ...(deltaY !== undefined && { deltaY }),
    }

    await this.operation(signal, async () => {
      this.verify(lease)
      this.observation = undefined // 消费旧观察
      await this.host.call('perform', {
        leaseId: lease.leaseId,
        epoch: lease.epoch,
        actionId,
        action: actionPayload,
      }, 120_000)
    })

    // UI 稳定等待
    const delay = actionKind === 'open_app' ? 1200 : actionKind === 'wait' ? Math.min(duration * 1000, 10_000) : 350
    await new Promise(r => setTimeout(r, delay))

    // 执行后立即截取最新画面返回
    const nextImg = await this.screenshot(signal)
    return {
      message: `动作 ${actionKind} 执行完成${app ? `: ${app}` : ''}${text ? `: "${text}"` : key ? `: "${key}"` : ''}`,
      image: nextImg,
    }
  }

  private async operation<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('已有原生操作在途，不允许重叠')
    if (signal?.aborted) throw new Error('操作已取消')
    this.busy = true
    const operationEpoch = this.epoch
    const abort = (): void => { if (this.epoch === operationEpoch) void this.stop('操作取消，授权已撤销', 'paused') }
    signal?.addEventListener('abort', abort, { once: true })
    try { return await run() }
    catch (error) { if (this.epoch === operationEpoch) await this.stop('原生操作失败或授权失效', 'paused'); throw error }
    finally { signal?.removeEventListener('abort', abort); this.busy = false }
  }
  async requestPermission(permission: ComputerPermission): Promise<ComputerState> {
    if (!['accessibility', 'screen', 'listen', 'post'].includes(permission)) throw new Error('无效系统权限类型')
    if (!this.state.supported || this.isExclusive() || this.activeRuns.size || this.reservations.size || this.permissionInFlight) throw new Error('请在没有运行与桌面租约时由本地用户单独设置系统权限')
    this.permissionInFlight = true
    let status: unknown
    try { status = await this.host.call('requestPermission', { permission }, 120_000) }
    finally { this.permissionInFlight = false }
    if (isRecord(status) && isRecord(status.permissions)) {
      const p = status.permissions
      if (['accessibility', 'screen', 'listen', 'post'].every(key => typeof p[key] === 'boolean')) {
        this.publish({ permissions: { accessibility: p.accessibility === true, screen: p.screen === true, listen: p.listen === true, post: p.post === true } })
      }
    }
    return this.getState()
  }
  /** 仅由可信本地 IPC 调用：清理旧 helper 并恢复待命，不创建租约、捕获或重放动作。 */
  async resume(): Promise<ComputerState> {
    if (!this.state.supported) throw new Error('原生桌面控制需要 macOS 14.2+')
    if (this.busy || this.permissionInFlight) throw new Error('已有原生操作在途，请稍后重新启用')
    const epoch = this.epoch
    await this.stop('正在清理旧桌面控制')
    if (this.stopFailed) throw new Error('旧原生进程尚未证明停止，请重试停止')
    // 新的停止请求优先于恢复；迟到的恢复响应不能解除用户停止。
    if (this.epoch !== epoch + 1) throw new Error('恢复已被新的停止请求取消')
    this.publish({ phase: 'disabled', resumeRequired: false, message: '桌面操作已重新启用。请在会话中继续任务；不会自动重放之前的动作。' })
    return this.getState()
  }
  /** 原生急停/监听失效只能撤权；事件/恢复消息从不重新 grant。 */
  nativeStopped(): void { void this.stop('原生安全门暂停，需重新由用户授权', 'paused') }
  stop(reason = '本地用户停止', finalPhase: 'disabled' | 'paused' = 'disabled'): Promise<ComputerState> {
    if (this.stopping) {
      this.epoch += 1
      return this.stopping
    }
    const revokedBinding = this.lease?.binding
    this.lease = undefined
    this.observation = undefined
    // 不等待helper退出才取消provider；必须先阻断在auth/重试中等待的观察副本。
    for (const entry of [...this.revocations]) {
      if (revokedBinding && sameBinding(entry.binding, revokedBinding)) {
        this.revocations.delete(entry)
        try { entry.listener() } catch { /* 撤权不能因取消回调失败而中止。 */ }
      }
    }
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.epoch += 1
    this.publish({ phase: 'stopping', resumeRequired: true, target: undefined, targetApp: undefined, pendingAction: undefined, consentId: undefined, message: reason })
    const stopping = this.host.terminate().then(() => {
      this.stopFailed = false
      this.publish({ phase: this.state.supported ? finalPhase : 'unsupported', message: reason })
      return this.getState()
    }).catch(() => {
      this.stopFailed = true
      this.publish({ phase: 'error', message: '旧 helper 未证明退出；禁止新租约与通用执行，需重试停止。' })
      return this.getState()
    }).finally(() => { if (this.stopping === stopping) this.stopping = undefined })
    this.stopping = stopping
    return stopping
  }
}
