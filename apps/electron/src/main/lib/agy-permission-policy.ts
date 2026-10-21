import type { GammaPermissionMode } from '@gamma/shared'

/** 外部执行与普通未知工具区分，完全自动模式也保留外派单次确认。 */
export function resolveAgyPermission(toolName: string, mode: GammaPermissionMode, source?: string): 'unrelated' | 'allow' | 'deny-plan' | 'deny-unattended' | 'single-approval' {
  if (['AgyList', 'AgyRead', 'AgyWait', 'AgyStop'].includes(toolName)) return 'allow'
  if (toolName !== 'AgyStart') return 'unrelated'
  if (mode === 'plan') return 'deny-plan'
  if ((source ?? 'user') !== 'user') return 'deny-unattended'
  return 'single-approval'
}
