import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  ComputerAppAuthDecision, ComputerAppAuthRequest, ComputerRiskConfirmRequest, ComputerUsePreferences,
} from '@gamma/shared'
import { getConfigDir } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'

export type AppAuthUiHandler = (request: ComputerAppAuthRequest) => Promise<ComputerAppAuthDecision>
export type RiskConfirmUiHandler = (request: ComputerRiskConfirmRequest) => Promise<boolean>
interface ConsentHandlers {
  appAuth?: AppAuthUiHandler
  riskConfirm?: RiskConfirmUiHandler
  observationConsent?: (signal?: AbortSignal) => Promise<boolean>
}
const normalizeKey = (value: string): string => value.trim().toLowerCase()
const validDecision = (value: unknown): value is ComputerAppAuthDecision => ['once', 'always', 'denied', 'cancelled'].includes(String(value))
const defaults = (): ComputerUsePreferences => ({ riskPolicy: 'standard', systemPermissionsDismissed: false, shareObservations: false, allowedApps: {} })

/** 持久授权与单轮执行分开；无人响应、超时、UI 故障一律拒绝。 */
export class ComputerAuthorizationManager {
  private preferences: ComputerUsePreferences
  private once = new Map<string, Set<string>>()
  private handlers: ConsentHandlers = {}
  private generation = 0
  private revision = 0
  private waits = new Set<AbortController>()
  private preferenceListeners = new Set<(preferences: ComputerUsePreferences) => void>()
  private pendingAppAuth = new Map<string, (decision: ComputerAppAuthDecision | undefined) => void>()
  private pendingRiskConfirm = new Map<string, (confirmed: boolean) => void>()
  private appAuthListeners = new Set<(req: ComputerAppAuthRequest) => void>()
  private riskConfirmListeners = new Set<(req: ComputerRiskConfirmRequest) => void>()
  constructor(private customConfigPath?: string) { this.preferences = this.loadPreferences() }
  private getConfigPath(): string { return this.customConfigPath ?? join(getConfigDir(), 'computer-use.json') }
  private loadPreferences(): ComputerUsePreferences {
    if (!existsSync(this.getConfigPath())) return defaults()
    try {
      const data: unknown = JSON.parse(readFileSync(this.getConfigPath(), 'utf8'))
      if (!data || typeof data !== 'object' || Array.isArray(data)) return defaults()
      const raw = data as Record<string, unknown>
      const result = defaults()
      if (raw.riskPolicy === 'strict' || raw.riskPolicy === 'standard' || raw.riskPolicy === 'relaxed') result.riskPolicy = raw.riskPolicy
      result.systemPermissionsDismissed = raw.systemPermissionsDismissed === true
      result.shareObservations = raw.shareObservations === true
      if (raw.allowedApps && typeof raw.allowedApps === 'object' && !Array.isArray(raw.allowedApps)) {
        for (const [key, value] of Object.entries(raw.allowedApps)) {
          // 旧实现默认信任 Notes，不能把默认值冒充用户的明确授权。
          const implicitLegacyNotes = raw.authorizationVersion !== 2 && ['notes', '备忘录', 'com.apple.notes'].includes(normalizeKey(key)) && value === 'always'
          if (!implicitLegacyNotes && key.length <= 256 && (value === 'always' || value === 'denied')) result.allowedApps[normalizeKey(key)] = value
        }
      }
      return result
    } catch { return defaults() }
  }
  getPreferences(): ComputerUsePreferences { return structuredClone(this.preferences) }
  updatePreferences(partial: Partial<ComputerUsePreferences>): ComputerUsePreferences {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial) || Object.keys(partial).some(key => !['riskPolicy', 'systemPermissionsDismissed', 'shareObservations', 'allowedApps'].includes(key))) throw new Error('无效桌面偏好')
    const next = this.getPreferences()
    if (partial.riskPolicy !== undefined) {
      if (!['strict', 'standard', 'relaxed'].includes(partial.riskPolicy)) throw new Error('无效确认策略')
      next.riskPolicy = partial.riskPolicy
    }
    for (const key of ['systemPermissionsDismissed', 'shareObservations'] as const) {
      if (partial[key] !== undefined) {
        if (typeof partial[key] !== 'boolean') throw new Error('无效授权偏好')
        next[key] = partial[key]
      }
    }
    if (partial.allowedApps !== undefined) {
      if (!partial.allowedApps || typeof partial.allowedApps !== 'object' || Array.isArray(partial.allowedApps)) throw new Error('无效应用授权')
      // 完整替换授权表，允许本地设置撤销单项决定。
      next.allowedApps = {}
      for (const [key, value] of Object.entries(partial.allowedApps)) {
        if (!key.trim() || key.length > 256 || !['always', 'denied'].includes(value)) throw new Error('无效应用授权')
        next.allowedApps[normalizeKey(key)] = value
      }
    }
    writeJsonFileAtomic(this.getConfigPath(), { ...next, authorizationVersion: 2 })
    if (partial.allowedApps !== undefined) {
      for (const keys of this.once.values()) for (const key of keys) {
        if ((this.preferences.allowedApps[key] !== undefined && next.allowedApps[key] === undefined) || next.allowedApps[key] === 'denied') keys.delete(key)
      }
    }
    this.preferences = next
    this.revision++
    for (const listener of this.preferenceListeners) listener(this.getPreferences())
    return this.getPreferences()
  }
  getRevision(): number { return this.revision }
  onPreferencesChanged(listener: (preferences: ComputerUsePreferences) => void): () => void {
    this.preferenceListeners.add(listener); return () => { this.preferenceListeners.delete(listener) }
  }
  private async waitForDecision<T>(create: (signal: AbortSignal) => Promise<T>, fallback: T): Promise<T> {
    const controller = new AbortController()
    this.waits.add(controller)
    let cancel!: () => void
    const cancelled = new Promise<T>(resolve => { cancel = () => resolve(fallback); controller.signal.addEventListener('abort', cancel, { once: true }) })
    const timer = setTimeout(() => controller.abort(), 120_000)
    try { return await Promise.race([Promise.resolve().then(() => create(controller.signal)).catch(() => fallback), cancelled]) }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); this.waits.delete(controller) }
  }
  private async showLocalDialog(options: import('electron').MessageBoxOptions, signal: AbortSignal): Promise<number> {
    const { dialog } = await import('electron')
    const { getMainWindow } = await import('./main-window-store')
    const window = getMainWindow()
    if (!window || window.isDestroyed() || signal.aborted) return options.cancelId ?? -1
    if (window.isMinimized()) window.restore()
    window.show(); window.focus()
    // macOS 无父窗口的 message box 会同步阻塞且不支持 signal；只使用可取消的窗口附属弹窗。
    return (await dialog.showMessageBox(window, { ...options, signal })).response
  }
  setUiHandlers(handlers: ConsentHandlers): void { this.handlers = { ...this.handlers, ...handlers } }
  onAppAuthRequested(listener: (req: ComputerAppAuthRequest) => void): () => void { this.appAuthListeners.add(listener); return () => { this.appAuthListeners.delete(listener) } }
  onRiskConfirmRequested(listener: (req: ComputerRiskConfirmRequest) => void): () => void { this.riskConfirmListeners.add(listener); return () => { this.riskConfirmListeners.delete(listener) } }
  resolveAppAuth(requestId: string, decision: ComputerAppAuthDecision): boolean {
    if (!validDecision(decision)) throw new Error('无效应用授权决定')
    const resolve = this.pendingAppAuth.get(requestId)
    if (!resolve) return false
    this.pendingAppAuth.delete(requestId); resolve(decision); return true
  }
  resolveRiskConfirm(requestId: string, confirmed: boolean): boolean {
    if (typeof confirmed !== 'boolean') throw new Error('无效确认决定')
    const resolve = this.pendingRiskConfirm.get(requestId)
    if (!resolve) return false
    this.pendingRiskConfirm.delete(requestId); resolve(confirmed); return true
  }
  /** 停止时立即关闭所有等待能力；迟到的 UI 结果既不投递也不记录新授权。 */
  cancelPending(): void {
    this.generation++
    for (const wait of this.waits) wait.abort()
    this.waits.clear()
    for (const resolve of this.pendingAppAuth.values()) resolve(undefined)
    for (const resolve of this.pendingRiskConfirm.values()) resolve(false)
    this.pendingAppAuth.clear(); this.pendingRiskConfirm.clear()
  }
  clearRun(scope: string): void { this.once.delete(scope) }
  checkAppAuthorization(appName: string, bundleId?: string, scope = 'local'): 'allowed' | 'denied' | 'pending' {
    // Bundle ID 是规范身份；显示名仅用于兼容旧配置，不得覆盖 bundle 的拒绝。
    const keys = [bundleId, appName].filter((key): key is string => !!key).map(normalizeKey)
    if (keys.some(key => this.preferences.allowedApps[key] === 'denied')) return 'denied'
    if (keys.some(key => this.preferences.allowedApps[key] === 'always' || this.once.get(scope)?.has(key))) return 'allowed'
    return 'pending'
  }
  recordAppDecision(appName: string, decision: Exclude<ComputerAppAuthDecision, 'cancelled'>, bundleId?: string, scope = 'local'): void {
    if (!validDecision(decision) || String(decision) === 'cancelled') throw new Error('无效应用授权决定')
    const keys = (bundleId ? [bundleId] : [appName]).map(normalizeKey)
    if (decision === 'once') {
      const allowed = this.once.get(scope) ?? new Set<string>()
      for (const key of keys) allowed.add(key)
      this.once.set(scope, allowed)
    } else {
      this.updatePreferences({ allowedApps: { ...this.preferences.allowedApps, ...Object.fromEntries(keys.map(key => [key, decision])) } })
    }
  }
  async ensureObservationConsent(): Promise<void> {
    if (this.preferences.shareObservations) return
    const generation = this.generation
    let allowed = false
    try {
      if (this.handlers.observationConsent) allowed = await this.waitForDecision(signal => this.handlers.observationConsent!(signal), false)
      else {
        const response = await this.waitForDecision(signal => this.showLocalDialog({ type: 'question', title: '首次使用电脑操作',
          message: '允许 Agent 按任务需要观察并操作电脑？',
          detail: '桌面截图和界面文字会发送给您配置的 AI 模型，可能包含屏幕上其他应用和敏感信息。仅在任务需要时截屏，不持续监控。接下来 macOS 会请求辅助功能、录屏、输入监听和事件发布权限。应用控制另行授权；高风险动作执行前确认。此同意会保存，可在本地撤销。',
          buttons: ['同意并继续', '取消'], defaultId: 1, cancelId: 1 }, signal), 1)
        allowed = response === 0
      }
    } catch { allowed = false }
    if (!allowed || generation !== this.generation) throw new Error('尚未同意把桌面截图发送给模型')
    this.updatePreferences({ shareObservations: true })
  }
  async ensureAppAuthorized(appName: string, bundleId?: string, scope = 'local'): Promise<boolean> {
    const current = this.checkAppAuthorization(appName, bundleId, scope)
    if (current === 'allowed') return true
    if (current === 'denied') throw new Error(`用户已明确拒绝操作应用: ${appName}`)
    const generation = this.generation
    const request: ComputerAppAuthRequest = { requestId: randomUUID(), appName, bundleId }
    let decision: ComputerAppAuthDecision | undefined
    try {
      if (this.handlers.appAuth) decision = await this.waitForDecision(() => this.handlers.appAuth!(request), undefined)
      else if (this.appAuthListeners.size) {
        decision = await new Promise<ComputerAppAuthDecision | undefined>(resolve => {
          const finish = (value: ComputerAppAuthDecision | undefined): void => { clearTimeout(timer); this.pendingAppAuth.delete(request.requestId); resolve(value) }
          const timer = setTimeout(() => finish(undefined), 120_000)
          this.pendingAppAuth.set(request.requestId, finish)
          let delivered = false
          for (const listener of this.appAuthListeners) { try { listener(request); delivered = true } catch { /* 未送达不代表用户拒绝。 */ } }
          if (!delivered) finish(undefined)
        })
      } else {
        const response = await this.waitForDecision(signal => this.showLocalDialog({ type: 'question', title: '应用控制授权', message: `Agent 请求操作应用：${appName}`,
          detail: bundleId ?? appName, buttons: ['本次允许', '总是允许', '总是拒绝', '取消'], defaultId: 3, cancelId: 3 }, signal), 3)
        decision = response === 0 ? 'once' : response === 1 ? 'always' : response === 2 ? 'denied' : undefined
      }
    } catch { decision = undefined }
    if (generation !== this.generation) throw new Error('应用授权等待已被停止')
    if (!validDecision(decision) || decision === 'cancelled') throw new Error('本次应用授权未完成，请重试；未保存任何应用决定')
    this.recordAppDecision(appName, decision, bundleId, scope)
    if (decision === 'denied') throw new Error(`用户拒绝了操作应用 ${appName} 的请求`)
    return true
  }
  async confirmRiskAction(request: ComputerRiskConfirmRequest): Promise<boolean> {
    const generation = this.generation
    let allowed = false
    try {
      if (this.handlers.riskConfirm) allowed = await this.waitForDecision(() => this.handlers.riskConfirm!(request), false)
      else {
        // Electron Touch ID 没有可取消API，使用可撤销的本地确认，不让急停被认证等待阻塞。
        if (this.riskConfirmListeners.size) {
          allowed = await new Promise<boolean>(resolve => {
            const finish = (value: boolean): void => { clearTimeout(timer); this.pendingRiskConfirm.delete(request.requestId); resolve(value) }
            const timer = setTimeout(() => finish(false), 60_000)
            this.pendingRiskConfirm.set(request.requestId, finish)
            for (const listener of this.riskConfirmListeners) { try { listener(request) } catch { /* 等待超时拒绝。 */ } }
          })
        } else {
          const response = await this.waitForDecision(signal => this.showLocalDialog({ type: 'warning', title: request.title, message: request.reason,
            detail: `目标应用：${request.targetApp ?? '未知'}`, buttons: ['确认执行', '取消'], defaultId: 1, cancelId: 1 }, signal), 1)
          allowed = response === 0
        }
      }
    } catch { allowed = false }
    return allowed && generation === this.generation
  }
}
export const computerAuthorizationManager = new ComputerAuthorizationManager()
