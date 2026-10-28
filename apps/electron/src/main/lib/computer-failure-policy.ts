import type { ComputerPermission } from '@gamma/shared'

export type ComputerFailurePhase = 'prepare' | 'confirmation' | 'read' | 'select' | 'perform' | 'after-dispatch'
export interface ComputerFailureEvidence {
  code?: string
  outcome?: string
  permission?: ComputerPermission
  phase: ComputerFailurePhase
}
export type ComputerFailureDisposition = 'reobserve' | 'permission' | 'pause'

// 仅在只读/准备阶段使用；perform 中相同错误码也可能出现在部分投递之后。
export const REOBSERVE_CODES: ReadonlySet<string> = new Set([
  'stale-observation', 'stale-element', 'stale-element-ref', 'preparation-required',
  'display-changed', 'desktop-changed', 'observation-layout-changed',
  'target-changed', 'target-gone', 'focus-changed', 'not-frontmost', 'application-mismatch',
  'unsafe-focus', 'unknown-target', 'unsafe-element', 'unscoped-surface',
  'ambiguous-selection', 'selection-not-found', 'selection-changed', 'invalid-selection', 'selection-budget',
  'unsupported-action', 'unsupported-format', 'cross-application-drag', 'secure-field', 'text-budget',
  'invalid-key', 'invalid-action', 'invalid-coordinate', 'application-not-found', 'ambiguous-application',
  'invalid-application', 'unknown-application', 'ambiguous-window', 'ambiguous-target', 'occluded', 'desktop-not-ready',
  'ax-read', 'ax-actions', 'ax-capability',
])
export const PAUSE_CODES: ReadonlySet<string> = new Set([
  'revoked', 'invalid-lease', 'input-held', 'secure-input', 'listen-disabled',
  'ax-timeout', 'listen-timeout', 'launch-unknown', 'app-open-failed', 'focus-unknown',
  'ax-write-unknown', 'post-action-not-settled',
])
export function classifyComputerFailure(evidence: ComputerFailureEvidence): ComputerFailureDisposition {
  if (evidence.phase === 'after-dispatch' || evidence.outcome === 'unknown' || evidence.outcome === 'outcome-unknown'
    || evidence.outcome === 'dispatched-unverified' || (evidence.code && PAUSE_CODES.has(evidence.code))) return 'pause'
  const beforeDispatch = evidence.outcome === 'not-dispatched' || evidence.outcome === 'rejected'
    || evidence.phase === 'prepare' || evidence.phase === 'confirmation' || evidence.phase === 'read' || evidence.phase === 'select'
  if (!beforeDispatch) return 'pause'
  if (evidence.code === 'permission-required' || evidence.code === 'screen-capture-required' || evidence.code === 'listen-denied') return 'permission'
  if (evidence.outcome === 'not-dispatched' || (evidence.code && REOBSERVE_CODES.has(evidence.code))) return 'reobserve'
  return 'pause'
}

export function missingComputerPermissionMessage(permission?: ComputerPermission): string {
  const names: Record<ComputerPermission, string> = { accessibility: '辅助功能', screen: '屏幕录制', listen: '输入监听', post: '事件发布' }
  const name = permission ? names[permission] : '系统（原生未指定具体权限）'
  return `缺少 ${name} 权限；动作未投递。请改用不依赖该权限的做法，或向用户说明并等待用户处理；不要反复请求授权。`
}
