import type { ComputerPhase, ComputerState } from '@gamma/shared'

/** renderer 只保留状态与 App 名，不接收窗口标题、截图、AX 或授权凭据。 */
export interface ComputerUseStatus {
  supported: boolean
  phase: ComputerPhase
  resumeRequired?: boolean
  sessionId?: string
  targetApp?: { bundleId: string; name: string }
  message?: string
  pendingAction?: { actionId: string; kind: NonNullable<ComputerState['pendingAction']>['kind'] }
}

export interface ComputerUseView {
  sessionId: string | null
  state: ComputerUseStatus | null
  loading: boolean
  pending: 'stop' | 'resume' | null
  error: string | null
}

export const COMPUTER_PHASE_LABELS: Record<ComputerPhase, string> = {
  disabled: '桌面待命', armed: '等待授权', authorizing: '等待授权',
  active: '正在操作桌面', paused: '桌面操作已暂停', stopping: '正在停止',
  error: '桌面操作异常', unsupported: '桌面操作不可用',
}

export function hasComputerControl(state: ComputerUseStatus | null): boolean {
  return state !== null && ['armed', 'authorizing', 'active', 'paused', 'stopping'].includes(state.phase)
}

/** IPC 扩展字段不应意外进入 React 状态或被序列化到 renderer。 */
export function projectComputerState(state: ComputerState): ComputerUseStatus {
  return {
    supported: state.supported,
    phase: state.phase,
    resumeRequired: state.resumeRequired,
    sessionId: state.sessionId,
    targetApp: state.targetApp ? { bundleId: state.targetApp.bundleId, name: state.targetApp.name } : undefined,
    message: state.message,
    pendingAction: state.pendingAction ? { actionId: state.pendingAction.actionId, kind: state.pendingAction.kind } : undefined,
  }
}

export function getComputerStatusLabel(view: ComputerUseView): string {
  if (view.pending === 'stop') return '正在停止'
  if (view.pending === 'resume') return '正在重新启用'
  if (view.error) return '桌面状态异常'
  if (!view.state) return view.loading ? '正在读取桌面状态' : '桌面状态未知'
  if (view.state.pendingAction) return '等待确认操作'
  if (view.state.phase === 'disabled' && view.state.resumeRequired) return '桌面操作已停止'
  return COMPUTER_PHASE_LABELS[view.state.phase]
}
