/** 原生桌面控制契约；观察原图与 AX 内容不属于持久化状态。 */
export type ComputerPhase = 'disabled' | 'armed' | 'authorizing' | 'active' | 'paused' | 'stopping' | 'error' | 'unsupported'
export interface ComputerBinding {
  sessionId: string
  runId: string
  channelId: string
  modelId: string
  /** 渠道endpoint/provider配置的哈希；不包含凭据，不向模型暴露。 */
  routeIdentity?: string
}
export interface ComputerRect { x: number; y: number; width: number; height: number }
export interface ComputerTarget {
  windowId: number
  pid: number
  processIdentity: string
  bundleId: string
  title: string
  bounds: ComputerRect
}
export interface ComputerPermissions { accessibility: boolean; screen: boolean; listen: boolean; post: boolean }
export type ComputerPermission = 'accessibility' | 'screen' | 'listen' | 'post'
export interface ComputerObservationDescriptor {
  observationId: string
  epoch: number
  width: number
  height: number
  createdAt: number
}
export interface ComputerAction {
  kind: 'click' | 'type' | 'key' | 'scroll' | 'axPress' | 'axSetValue'
  /** 必须来自当前最新一次观察；不能跨目标或跨运行重放。 */
  observationId: string
  x?: number
  y?: number
  text?: string
  key?: 'Enter' | 'Escape' | 'Tab' | 'Backspace' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
  deltaY?: number
  elementRef?: string
  /** 模型描述业务意图；原生风险检查不因模型声明 normal 而跳过。 */
  intent?: string
  risk?: 'normal' | 'high'
}
export interface ComputerActionReceipt {
  actionId: string
  outcome: 'dispatched-unverified' | 'outcome-unknown' | 'rejected'
  message: string
}
export interface ComputerState {
  supported: boolean
  phase: ComputerPhase
  /** 同轮停止不可自行恢复；下一条明确用户消息可开始新动作，不重放旧动作。 */
  resumeRequired?: boolean
  sessionId?: string
  channelId?: string
  modelId?: string
  /** 最近一次已验证渠道/模型的短期本地确认上下文。 */
  consentId?: string
  target?: ComputerTarget
  targetApp?: { bundleId: string; name: string }
  permissions?: ComputerPermissions
  message?: string
  /** 原生层仅为高风险或无法辨别副作用的动作请求确认。 */
  pendingAction?: { actionId: string; kind: ComputerAction['kind'] }
}
export interface ComputerArmInput {
  sessionId: string
  consentId?: string
  shareObservations: boolean
}

/** 仅供可信聊天界面临时展示；不进入工具回执、历史、日志或同步。 */
export interface ComputerPreview {
  sessionId: string
  runId: string
  phase: ComputerPhase
  appName?: string
  mode: 'starting' | 'live' | 'accessibility' | 'paused' | 'unavailable'
  /** 辅助功能可独立操作；录屏仅用于可选画面。 */
  permissions?: ComputerPermissions
  message?: string
  /** 监控帧不能作为工具 observationId；只在本机显示，不送入模型。 */
  frame?: { frameId: string; capturedAt: number; width: number; height: number; dataUrl?: string }
  activities: { id: string; action: string; status: 'running' | 'returned' | 'failed'; startedAt: number }[]
}
export interface ComputerPreviewRequest {
  sessionId: string
  runId?: string
  frameId?: string
  live: boolean
}

export const COMPUTER_IPC_CHANNELS = {
  GET_STATE: 'computer:get-state',
  GET_PREVIEW: 'computer:get-preview',
  STOP_PREVIEW: 'computer:stop-preview',
  STOP: 'computer:stop',
  RESUME: 'computer:resume',
  ARM: 'computer:arm',
  PERMISSION: 'computer:permission',
  STATE_CHANGED: 'computer:state-changed',
  GET_PREFERENCES: 'computer:get-preferences',
  UPDATE_PREFERENCES: 'computer:update-preferences',
  DECIDE_APP_AUTH: 'computer:decide-app-auth',
  DECIDE_RISK_CONFIRM: 'computer:decide-risk-confirm',
  APP_AUTH_REQUESTED: 'computer:app-auth-requested',
  RISK_CONFIRM_REQUESTED: 'computer:risk-confirm-requested',
} as const

export type ComputerRiskPolicy = 'strict' | 'standard' | 'relaxed'
export type ComputerRiskLevel = 'low' | 'medium' | 'high'
export type ComputerAppAuthDecision = 'always' | 'once' | 'denied' | 'cancelled'

export interface ComputerAXContext {
  appName?: string
  bundleId?: string
  role?: string
  subrole?: string
  title?: string
  description?: string
  isSecure?: boolean
  /** 原生层确认位于浏览器chrome地址/搜索栏，而非网页自报标签。 */
  isTrustedSearch?: boolean
}

export interface ComputerUsePreferences {
  riskPolicy: ComputerRiskPolicy
  systemPermissionsDismissed: boolean
  /** 本地用户对桌面截图发送至所配置模型的持久同意；dismiss 不代表同意。 */
  shareObservations?: boolean
  allowedApps: Record<string, 'always' | 'denied'>
}

export interface ComputerAppAuthRequest {
  requestId: string
  appName: string
  bundleId?: string
}

export interface ComputerRiskConfirmRequest {
  requestId: string
  title: string
  reason: string
  actionKind: string
  targetApp?: string
  authMethod: 'touch-id' | 'dialog'
}

/** 仅 main → utility 的请求前内存能力，绝不作为模型可调用工具。 */
export interface ComputerPrivateObservation {
  observationId: string
  epoch: number
  /** 没有录屏权限时只提供 AX，不伪造截图或要求额外系统授权。 */
  image?: { data: string; mimeType: 'image/png'; width: number; height: number }
  width?: number
  height?: number
  ax: string
}

