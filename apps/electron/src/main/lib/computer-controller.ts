import { randomUUID } from 'node:crypto'
import type {
  ComputerBinding,
  ComputerPermission,
  ComputerPermissions,
  ComputerPreview,
  ComputerPreviewRequest,
  ComputerState,
} from '@gamma/shared'
import {
  computerAuthorizationManager,
  type ComputerAuthorizationManager,
} from './computer-authorization-manager'
import {
  AGENT_DESKTOP_VERSION,
  buildAgentDesktopArgs,
  type AgentDesktopEnvelope,
  type AgentDesktopInput,
} from './agent-desktop-protocol'
import type { InstalledComputerApp } from './computer-installed-app'
import { authorizeComputerTarget, type ComputerRefTarget } from './computer-target-guard'
import { ComputerRunPausedError, computerPausedToolMessage } from './computer-pause'

export interface ComputerStopDiagnostic {
  action?: string
  rawError: string
  errorCode: string | null
  outcome: string
}

export interface ComputerHost {
  execute(
    namespace: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs?: number,
    validate?: () => void,
  ): Promise<AgentDesktopEnvelope>
  terminate(namespace?: string): Promise<void>
  resolveInstalledApp?(identifier: string): Promise<InstalledComputerApp | undefined>
  resolveRefTarget?(namespace: string, ref: string): Promise<ComputerRefTarget>
  call?(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown>
}

export interface ComputerExecuteParams {
  command?: string
  action?: string
  ref?: string
  app?: string
  windowId?: string | number
  text?: string
  value?: string
  combo?: string
  headed?: boolean
  [key: string]: unknown
}

interface RunContext {
  binding: ComputerBinding
  source: string
  vision: boolean
  consentId: string
  updatedAt: number
}

const COMPUTER_TOOLS = new Set([
  'ComputerStatus',
  'ComputerObserve',
  'ComputerAct',
  'ComputerStop',
  'computer',
])

const sameBinding = (a: ComputerBinding, b: ComputerBinding): boolean =>
  a.sessionId === b.sessionId &&
  a.runId === b.runId &&
  a.channelId === b.channelId &&
  a.modelId === b.modelId &&
  a.routeIdentity === b.routeIdentity

/**
 * 纯主进程策略与 Agent 控制器。
 * 基于 vercel-labs/agent-desktop 原生自动化引擎驱动，负责会话隔离、权限门禁、高风险确认与可见停止。
 */
export class ComputerController {
  private state: ComputerState
  private contexts = new Map<string, RunContext>()
  private activeRuns = new Map<string, ComputerBinding>()
  private stoppedRuns = new Set<string>()
  private stoppedRunReasons = new Map<string, string>()
  private desktopRuns = new Set<string>()
  private reservations = new Map<string, string>()
  private permissionInFlight = false
  private stopping?: Promise<ComputerState>
  private stopFailed = false
  private listeners = new Set<(state: ComputerState) => void>()
  private revocations = new Set<{ binding: ComputerBinding; listener: () => void }>()
  private readonly now: () => number
  private lastStopReason = new Map<string, string>()
  private previewActivities: ComputerPreview['activities'] = []
  private activeAction?: string
  readonly authManager: ComputerAuthorizationManager

  constructor(
    private readonly host: ComputerHost,
    options: {
      supported?: boolean
      now?: () => number
      authManager?: ComputerAuthorizationManager
    } = {},
  ) {
    const supported = options.supported ?? (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux')
    this.authManager = options.authManager ?? computerAuthorizationManager
    this.now = options.now ?? Date.now

    this.state = {
      backend: 'agent-desktop',
      backendVersion: AGENT_DESKTOP_VERSION,
      headedAllowed: this.authManager.getPreferences().headedAllowed ?? false,
      supported,
      phase: supported ? 'disabled' : 'unsupported',
    }

    this.authManager.onPreferencesChanged((preferences) => {
      this.state.headedAllowed = preferences.headedAllowed ?? false
      if (!preferences.shareObservations && this.activeRuns.size > 0) {
        void this.stop('截图外发同意已撤销', 'paused')
      }
    })
  }

  getLastStopReason(sessionId?: string): string | undefined {
    if (sessionId && this.lastStopReason.has(sessionId)) {
      return this.lastStopReason.get(sessionId)
    }
    return undefined
  }

  isRunStopped(runId: string): boolean {
    return this.stoppedRuns.has(runId)
  }

  getRunStopReason(runId: string): string | undefined {
    return this.stoppedRunReasons.get(runId)
  }

  toolDenialMessage(binding: ComputerBinding, _error: unknown): string {
    if (this.isRunStopped(binding.runId)) {
      return computerPausedToolMessage(this.getRunStopReason(binding.runId))
    }
    return computerPausedToolMessage('电脑操作已停止')
  }

  onState(listener: (state: ComputerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<ComputerState>): void {
    this.state = {
      ...this.state,
      ...patch,
      backend: 'agent-desktop',
      backendVersion: AGENT_DESKTOP_VERSION,
      headedAllowed: this.authManager.getPreferences().headedAllowed ?? false,
    }
    for (const listener of this.listeners) {
      try {
        listener(this.state)
      } catch {}
    }
  }

  getState(_sessionId?: string): ComputerState {
    return {
      ...this.state,
      backend: 'agent-desktop',
      backendVersion: AGENT_DESKTOP_VERSION,
      headedAllowed: this.authManager.getPreferences().headedAllowed ?? false,
    }
  }

  isDesktopRun(binding: ComputerBinding): boolean {
    return this.desktopRuns.has(binding.runId)
  }

  async refreshState(sessionId?: string): Promise<ComputerState> {
    if (!this.state.supported) return this.getState(sessionId)
    const probeRes = await this.host.execute(
      `status-probe-${Date.now()}`,
      ['status'],
      undefined,
      5000,
    )
    if (!probeRes.ok) {
      throw new Error(probeRes.error?.message || '无法读取原生权限状态')
    }
    if (probeRes.data && typeof probeRes.data === 'object') {
      const raw = probeRes.data as {
        permissions?: {
          accessibility?: { state?: string }
          screen_recording?: { state?: string }
        }
      }
      const perms: ComputerPermissions = {
        accessibility: raw.permissions?.accessibility?.state === 'granted',
        screen: raw.permissions?.screen_recording?.state === 'granted',
        listen: false,
        post: false,
      }
      this.publish({ permissions: perms })
    }
    return this.getState(sessionId)
  }

  onRevoked(binding: ComputerBinding, listener: () => void): () => void {
    const entry = { binding, listener }
    this.revocations.add(entry)
    return () => this.revocations.delete(entry)
  }

  reserveRun(sessionId: string): () => void {
    if (
      [...this.reservations.values()].includes(sessionId) ||
      this.permissionInFlight ||
      this.stopping ||
      this.stopFailed
    ) {
      throw new Error('已有桌面控制或系统授权操作，不能并发启动其他运行')
    }
    const token = randomUUID()
    this.reservations.set(token, sessionId)
    return () => this.reservations.delete(token)
  }

  beginRun(binding: ComputerBinding, source: string, vision: boolean): boolean {
    if (this.stopping || this.stopFailed || this.permissionInFlight) {
      throw new Error('旧原生进程尚未证明停止或系统授权正在进行')
    }
    if (this.stoppedRuns.has(binding.runId)) {
      throw new ComputerRunPausedError(
        this.getRunStopReason(binding.runId) ?? '未提供停止原因',
      )
    }

    const consentId = randomUUID()
    const context: RunContext = {
      binding,
      source,
      vision,
      consentId,
      updatedAt: this.now(),
    }
    this.contexts.set(binding.runId, context)
    this.activeRuns.set(binding.runId, binding)

    if (source === 'user') {
      this.publish({
        phase: this.state.supported ? 'armed' : 'unsupported',
        sessionId: binding.sessionId,
        channelId: binding.channelId,
        modelId: binding.modelId,
        consentId,
        resumeRequired: false,
      })
    }
    return true
  }

  async finishRun(binding: ComputerBinding): Promise<void> {
    this.authManager.cancelPending()
    this.activeRuns.delete(binding.runId)
    this.desktopRuns.delete(binding.runId)
    this.contexts.delete(binding.runId)
    this.authManager.clearRun(binding.runId)
    this.stoppedRuns.delete(binding.runId)
    this.stoppedRunReasons.delete(binding.runId)

    await this.host.terminate(binding.runId)

    if (this.activeRuns.size === 0) {
      this.publish({
        phase: this.state.supported ? 'disabled' : 'unsupported',
        sessionId: undefined,
        channelId: undefined,
        modelId: undefined,
        targetApp: undefined,
        pendingAction: undefined,
        resumeRequired: false,
      })
    }
  }

  async stopForSession(sessionId: string, reason: string): Promise<void> {
    this.lastStopReason.set(sessionId, reason)
    // 桌面停止本来就是全局屏障；复用唯一入口，先失效确认再等待退出，失败也会发布 error。
    await this.stop(reason)
  }

  isExclusive(): boolean {
    return this.state.phase === 'armed' || this.state.phase === 'active' || !!this.stopping || this.stopFailed
  }

  assertTool(binding: ComputerBinding, toolName: string): void {
    if (!COMPUTER_TOOLS.has(toolName) && toolName !== 'computer') return
    if (this.isRunStopped(binding.runId)) {
      throw new ComputerRunPausedError(
        this.getRunStopReason(binding.runId) ?? '未提供停止原因',
      )
    }
    const context = this.contexts.get(binding.runId)
    if (context?.source !== 'user') throw new Error('后台任务不允许桌面操控')
    const active = this.activeRuns.get(binding.runId)
    if (!active || !sameBinding(active, binding) || this.stopping) {
      throw new Error('没有当前运行有效的本地桌面授权')
    }
  }

  assertObservationSharing(binding: ComputerBinding): void {
    if (this.isRunStopped(binding.runId)) {
      throw new ComputerRunPausedError(
        this.getRunStopReason(binding.runId) ?? '未提供停止原因',
      )
    }
    const preferences = this.authManager.getPreferences()
    if (!preferences.shareObservations) {
      throw new Error(
        '尚未取得桌面观察外发同意；请在设置或弹窗中明确同意向模型发送界面文字与截图。',
      )
    }
  }

  assertExternalExecutionAllowed(): void {
    if (this.isExclusive()) {
      throw new Error('已有桌面控制处于活跃或等待状态')
    }
  }

  nativeStopped(reason = '原生进程退出'): void {
    void this.stop(reason, 'paused')
  }

  async stop(
    reason = '本地用户停止',
    finalPhase: 'disabled' | 'paused' = 'disabled',
    blockCurrentRun = true,
    _diagnostic?: ComputerStopDiagnostic,
  ): Promise<ComputerState> {
    for (const active of this.activeRuns.values()) {
      this.lastStopReason.set(active.sessionId, reason)
      if (blockCurrentRun) {
        this.stoppedRuns.add(active.runId)
        this.stoppedRunReasons.set(active.runId, reason)
      }
    }

    this.authManager.cancelPending()
    for (const runId of this.activeRuns.keys()) this.authManager.clearRun(runId)

    if (this.stopping) return this.stopping

    for (const entry of [...this.revocations]) {
      try {
        entry.listener()
      } catch {}
    }
    this.revocations.clear()

    this.publish({
      phase: 'stopping',
      resumeRequired: blockCurrentRun,
      target: undefined,
      targetApp: undefined,
      pendingAction: undefined,
      message: reason,
    })

    const stopping = this.host
      .terminate()
      .then(() => {
        this.stopFailed = false
        this.activeRuns.clear()
        this.desktopRuns.clear()
        this.publish({
          phase: finalPhase,
          resumeRequired: blockCurrentRun,
          message: reason,
        })
        return this.state
      })
      .catch(() => {
        this.stopFailed = true
        this.publish({
          phase: 'error',
          resumeRequired: true,
          message: `${reason}（进程退出未完全确认）`,
        })
        return this.state
      })
      .finally(() => {
        if (this.stopping === stopping) this.stopping = undefined
      })

    this.stopping = stopping
    return stopping
  }

  async resume(): Promise<ComputerState> {
    if (!this.state.supported) {
      throw new Error('原生桌面控制当前平台不可用')
    }
    if (this.permissionInFlight) {
      throw new Error('已有原生操作在途，请稍后重新启用')
    }
    await this.stop('正在清理旧桌面控制')
    if (this.stopFailed) {
      throw new Error('旧原生进程尚未证明停止，请重试停止')
    }

    this.stoppedRuns.clear()
    this.stoppedRunReasons.clear()
    this.publish({
      phase: 'disabled',
      resumeRequired: false,
      message: '桌面操作已重新启用。请在会话中继续任务；不会自动重放之前的动作。',
    })
    return this.state
  }

  async requestPermission(permission: ComputerPermission): Promise<ComputerState> {
    if (this.permissionInFlight || this.stopping) {
      throw new Error('请在没有在途操作时设置系统权限')
    }
    this.permissionInFlight = true
    try {
      if (permission === 'accessibility') {
        await this.host.execute('perm-req', ['permissions', '--request'])
      } else if (permission === 'screen') {
        await this.host.execute('perm-req', ['permissions', '--guide'])
      }
    } catch {
      // 忽略启动错误，刷新最新状态
    } finally {
      this.permissionInFlight = false
    }
    return await this.refreshState()
  }

  async getPreview({
    sessionId,
    runId,
    live,
    frameId,
  }: ComputerPreviewRequest): Promise<ComputerPreview | null> {
    if (
      this.stopping ||
      !this.authManager.getPreferences().shareObservations
    ) {
      return null
    }

    const active = runId
      ? this.activeRuns.get(runId)
      : [...this.activeRuns.values()].find((b) => b.sessionId === sessionId)
    if (!active || active.sessionId !== sessionId || !this.isDesktopRun(active)) return null

    let frameRes: unknown
    if (this.host.call) {
      try {
        frameRes = await this.host.call('previewFrame', { enabled: live, frameId })
      } catch {}
    }

    if (!this.authManager.getPreferences().shareObservations || this.stopping || this.activeRuns.get(active.runId) !== active || this.isRunStopped(active.runId)) {
      return null
    }

    const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
    const response = isRecord(frameRes) ? frameRes : undefined
    const rawMode = response?.mode
    const mode: ComputerPreview['mode'] = rawMode === 'live' || rawMode === 'accessibility' || rawMode === 'paused' || rawMode === 'unavailable'
      ? rawMode : 'accessibility'
    const rawFrame = isRecord(response?.frame) ? response.frame : undefined
    const frame = rawFrame && typeof rawFrame.frameId === 'string' ? {
      frameId: rawFrame.frameId,
      capturedAt: typeof rawFrame.capturedAt === 'number' ? rawFrame.capturedAt : this.now(),
      width: typeof rawFrame.width === 'number' ? rawFrame.width : 960,
      height: typeof rawFrame.height === 'number' ? rawFrame.height : 600,
      dataUrl: frameId === rawFrame.frameId ? undefined : typeof rawFrame.dataUrl === 'string' ? rawFrame.dataUrl
        : typeof rawFrame.data === 'string' ? `data:image/jpeg;base64,${rawFrame.data}` : undefined,
    } : undefined

    return {
      sessionId,
      runId: active.runId,
      phase: this.state.phase,
      appName: this.state.targetApp?.name,
      mode,
      permissions: this.state.permissions,
      message: this.state.message,
      frame,
      activities: this.previewActivities,
    }
  }

  async stopPreview(sessionId: string, runId: string): Promise<ComputerState> {
    const active = this.activeRuns.get(runId)
    if (!active || active.sessionId !== sessionId) {
      throw new Error('桌面操作已结束或属于其他会话')
    }
    await this.stopForSession(sessionId, '用户通过预览停止桌面操作')
    return this.getState(sessionId)
  }

  /**
   * 执行 agent-desktop 命令。
   * 集成白名单参数校验、应用授权、headed 许可校验与高风险动作确认。
   */
  async execute(
    binding: ComputerBinding,
    input: AgentDesktopInput,
    signal?: AbortSignal,
  ): Promise<AgentDesktopEnvelope> {
    buildAgentDesktopArgs(input)
    const assertCurrent = (): void => {
      this.assertTool(binding, 'computer')
      this.assertObservationSharing(binding)
      if (signal?.aborted) throw new Error('操作已取消')
      if (input.headed && !this.authManager.getPreferences().headedAllowed) {
        throw new Error('未开启物理键鼠输入许可；请在设置中开启 headed，或使用 headless 语义操作。')
      }
    }
    assertCurrent()

    const authorized = await authorizeComputerTarget(this.host, this.authManager, binding.runId, input, assertCurrent, signal)
    authorized.validate()
    input = authorized.input
    const args = buildAgentDesktopArgs(input)

    // 敏感高风险动作二次确认
    const highRiskCommands = new Set([
      'clipboard-get',
      'clipboard-set',
      'clipboard-clear',
      'close-app',
      'dismiss-all-notifications',
    ])
    const isDangerousPress = input.command === 'press' && input.force === true

    if (highRiskCommands.has(input.command) || isDangerousPress) {
      const confirmed = await this.authManager.confirmRiskAction({
        requestId: randomUUID(),
        title: '高风险桌面操作确认',
        reason: `Agent 请求执行 ${input.command}${isDangerousPress ? ' (强制按键)' : ''}，此操作可能修改剪贴板、关闭应用或覆盖系统设置。`,
        actionKind: input.command,
        targetApp: typeof input.app === 'string' ? input.app : undefined,
        authMethod: 'dialog',
      })
      assertCurrent()
      if (!confirmed) {
        throw new Error(`用户已取消高风险动作: ${input.command}`)
      }
    }

    authorized.validate()
    const activityId = randomUUID()
    const activity: ComputerPreview['activities'][number] = {
      id: activityId,
      action: input.command,
      status: 'running',
      startedAt: this.now(),
    }
    this.previewActivities.push(activity)
    if (this.previewActivities.length > 20) {
      this.previewActivities.shift()
    }

    this.activeAction = input.command
    this.desktopRuns.add(binding.runId)
    this.publish({ phase: 'active' })

    try {
      authorized.validate()
      const envelope = await this.host.execute(binding.runId, args, signal, undefined, authorized.validate)
      try { authorized.validate() } catch {
        throw new ComputerRunPausedError('执行期间授权或运行状态已变化；动作可能已投递，观察结果已丢弃，不得重放。')
      }
      activity.status = envelope.ok ? 'returned' : 'failed'

      if (!envelope.ok && envelope.error?.code === 'PERM_DENIED') {
        void this.refreshState(binding.sessionId)
      }

      return envelope
    } catch (err) {
      activity.status = 'failed'
      throw err
    } finally {
      this.activeAction = undefined
      if (this.activeRuns.size > 0 && this.state.phase === 'active') {
        this.publish({ phase: 'armed' })
      }
    }
  }
}
