import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  ComputerAppAuthDecision,
  ComputerAppAuthRequest,
  ComputerRiskConfirmRequest,
  ComputerRiskPolicy,
  ComputerUsePreferences,
} from '@gamma/shared'
import { getConfigDir } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'

export type AppAuthUiHandler = (request: ComputerAppAuthRequest) => Promise<ComputerAppAuthDecision>
export type RiskConfirmUiHandler = (request: ComputerRiskConfirmRequest) => Promise<boolean>

function createDefaultPreferences(): ComputerUsePreferences {
  return {
    riskPolicy: 'standard',
    systemPermissionsDismissed: false,
    allowedApps: {
      notes: 'always',
      备忘录: 'always',
      'com.apple.notes': 'always',
    },
  }
}

function normalizeKey(app: string): string {
  return (app ?? '').trim().toLowerCase()
}

export class ComputerAuthorizationManager {
  private preferences: ComputerUsePreferences
  private sessionDecisions = new Map<string, 'once'>()
  private appAuthHandler?: AppAuthUiHandler
  private riskConfirmHandler?: RiskConfirmUiHandler
  private pendingAppAuth = new Map<string, (decision: ComputerAppAuthDecision) => void>()
  private pendingRiskConfirm = new Map<string, (confirmed: boolean) => void>()
  private appAuthListeners = new Set<(req: ComputerAppAuthRequest) => void>()
  private riskConfirmListeners = new Set<(req: ComputerRiskConfirmRequest) => void>()

  constructor(private customConfigPath?: string) {
    this.preferences = this.loadPreferences()
  }

  private getConfigPath(): string {
    return this.customConfigPath ?? join(getConfigDir(), 'computer-use.json')
  }

  private loadPreferences(): ComputerUsePreferences {
    const filePath = this.getConfigPath()
    if (!existsSync(filePath)) return createDefaultPreferences()
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw) as Partial<ComputerUsePreferences>
      const defaults = createDefaultPreferences()
      return {
        riskPolicy: ['strict', 'standard', 'relaxed'].includes(data.riskPolicy ?? '') ? data.riskPolicy! : 'standard',
        systemPermissionsDismissed: data.systemPermissionsDismissed === true,
        allowedApps: typeof data.allowedApps === 'object' && data.allowedApps !== null ? { ...defaults.allowedApps, ...data.allowedApps } : defaults.allowedApps,
      }
    } catch {
      return createDefaultPreferences()
    }
  }

  private savePreferences(): void {
    const filePath = this.getConfigPath()
    try {
      writeJsonFileAtomic(filePath, this.preferences)
    } catch (error) {
      console.warn('[ComputerAuth] 保存配置失败:', error)
    }
  }

  getPreferences(): ComputerUsePreferences {
    return {
      ...this.preferences,
      allowedApps: { ...this.preferences.allowedApps },
    }
  }

  updatePreferences(partial: Partial<ComputerUsePreferences>): ComputerUsePreferences {
    if (partial.riskPolicy && ['strict', 'standard', 'relaxed'].includes(partial.riskPolicy)) {
      this.preferences.riskPolicy = partial.riskPolicy
    }
    if (typeof partial.systemPermissionsDismissed === 'boolean') {
      this.preferences.systemPermissionsDismissed = partial.systemPermissionsDismissed
    }
    if (partial.allowedApps) {
      this.preferences.allowedApps = { ...this.preferences.allowedApps, ...partial.allowedApps }
    }
    this.savePreferences()
    return this.getPreferences()
  }

  onAppAuthRequested(listener: (req: ComputerAppAuthRequest) => void): () => void {
    this.appAuthListeners.add(listener)
    return () => this.appAuthListeners.delete(listener)
  }

  onRiskConfirmRequested(listener: (req: ComputerRiskConfirmRequest) => void): () => void {
    this.riskConfirmListeners.add(listener)
    return () => this.riskConfirmListeners.delete(listener)
  }

  resolveAppAuth(requestId: string, decision: ComputerAppAuthDecision): boolean {
    const resolver = this.pendingAppAuth.get(requestId)
    if (resolver) {
      this.pendingAppAuth.delete(requestId)
      resolver(decision)
      return true
    }
    return false
  }

  resolveRiskConfirm(requestId: string, confirmed: boolean): boolean {
    const resolver = this.pendingRiskConfirm.get(requestId)
    if (resolver) {
      this.pendingRiskConfirm.delete(requestId)
      resolver(confirmed)
      return true
    }
    return false
  }

  setUiHandlers(handlers: { appAuth?: AppAuthUiHandler; riskConfirm?: RiskConfirmUiHandler }): void {
    if (handlers.appAuth) this.appAuthHandler = handlers.appAuth
    if (handlers.riskConfirm) this.riskConfirmHandler = handlers.riskConfirm
  }

  checkAppAuthorization(appName: string, bundleId?: string): 'allowed' | 'denied' | 'pending' {
    const appKey = normalizeKey(appName)
    const bundleKey = bundleId ? normalizeKey(bundleId) : undefined

    const SYSTEM_SURFACES = new Set(['desktop', 'full desktop', 'com.apple.desktop', 'com.apple.dock'])
    if (SYSTEM_SURFACES.has(appKey)) {
      return 'allowed'
    }

    if (this.sessionDecisions.get(appKey) === 'once' || (bundleKey && this.sessionDecisions.get(bundleKey) === 'once')) {
      return 'allowed'
    }

    if (this.preferences.allowedApps[appKey] === 'always' || (bundleKey && this.preferences.allowedApps[bundleKey] === 'always')) {
      return 'allowed'
    }

    if (this.preferences.allowedApps[appKey] === 'denied' || (bundleKey && this.preferences.allowedApps[bundleKey] === 'denied')) {
      return 'denied'
    }

    return 'pending'
  }

  recordAppDecision(appName: string, decision: ComputerAppAuthDecision, bundleId?: string): void {
    const key = normalizeKey(appName)
    if (decision === 'once') {
      this.sessionDecisions.set(key, 'once')
      if (bundleId) this.sessionDecisions.set(normalizeKey(bundleId), 'once')
    } else {
      this.preferences.allowedApps[key] = decision
      if (bundleId) this.preferences.allowedApps[normalizeKey(bundleId)] = decision
      this.savePreferences()
    }
  }

  async ensureAppAuthorized(appName: string, bundleId?: string): Promise<boolean> {
    const current = this.checkAppAuthorization(appName, bundleId)
    if (current === 'allowed') return true
    if (current === 'denied') throw new Error(`用户已明确拒绝操作应用: ${appName}`)

    // 需向用户申请授权
    let decision: ComputerAppAuthDecision = 'denied'
    const request: ComputerAppAuthRequest = {
      requestId: randomUUID(),
      appName,
      bundleId,
    }

    if (this.appAuthHandler) {
      decision = await this.appAuthHandler(request)
    } else if (this.appAuthListeners.size > 0) {
      // 广播给 UI / Renderer 弹窗，并等待回调或超时
      decision = await new Promise<ComputerAppAuthDecision>((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingAppAuth.delete(request.requestId)
          resolve('once')
        }, 120_000)
        this.pendingAppAuth.set(request.requestId, (d) => {
          clearTimeout(timeout)
          resolve(d)
        })
        for (const listener of this.appAuthListeners) {
          try { listener(request) } catch {}
        }
      })
    } else {
      // 原生 Electron 对话框兜底
      try {
        const { dialog } = require('electron')
        const res = await dialog.showMessageBox({
          type: 'question',
          buttons: ['本次允许', '总是允许', '拒绝'],
          defaultId: 0,
          cancelId: 2,
          title: '应用控制授权',
          message: `Agent 请求操作应用：${appName}`,
          detail: '允许后 Agent 可以使用鼠标和键盘与该应用进行自动化交互。',
        })
        decision = res.response === 0 ? 'once' : res.response === 1 ? 'always' : 'denied'
      } catch {
        decision = 'once'
      }
    }

    this.recordAppDecision(appName, decision, bundleId)
    if (decision === 'denied') {
      throw new Error(`用户拒绝了操作应用 ${appName} 的请求`)
    }
    return true
  }

  async confirmRiskAction(request: ComputerRiskConfirmRequest): Promise<boolean> {
    if (this.riskConfirmHandler) {
      return await this.riskConfirmHandler(request)
    }

    // 尝试 macOS 原生 Touch ID
    if (request.authMethod === 'touch-id') {
      try {
        const { systemPreferences } = require('electron')
        if (typeof systemPreferences?.canPromptTouchID === 'function' && systemPreferences.canPromptTouchID()) {
          await systemPreferences.promptTouchID(`核验 Touch ID 以批准操作：${request.reason}`)
          return true
        }
      } catch {
        // Touch ID 被用户取消或不支持，回退到对话框确认
      }
    }

    if (this.riskConfirmListeners.size > 0) {
      return await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingRiskConfirm.delete(request.requestId)
          resolve(false)
        }, 60_000)
        this.pendingRiskConfirm.set(request.requestId, (confirmed) => {
          clearTimeout(timeout)
          resolve(confirmed)
        })
        for (const listener of this.riskConfirmListeners) {
          try { listener(request) } catch {}
        }
      })
    }

    // 原生弹窗确认兜底
    try {
      const { dialog } = require('electron')
      const res = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['确认执行', '取消并中止'],
        defaultId: 1,
        cancelId: 1,
        title: request.title,
        message: `高风险操作确认: ${request.actionKind}`,
        detail: request.reason,
      })
      return res.response === 0
    } catch {
      return true
    }
  }
}

export const computerAuthorizationManager = new ComputerAuthorizationManager()
