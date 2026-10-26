/**
 * right-panel-theme — 右侧面板语义主题与样式映射
 *
 * 遵循 Gamma 工程约定，不硬编码 raw tailwind 颜色值或带 fallback 的硬编码值，
 * 统一复用系统语义 token：diff-addition、destructive、muted-foreground、diff-untracked 等。
 */

export const diffBadgeClasses = {
  addition: 'text-[hsl(var(--diff-addition))] font-mono font-medium',
  deletion: 'text-destructive font-mono font-medium',
  neutral: 'text-muted-foreground font-mono font-normal',
  untracked: 'text-[hsl(var(--diff-untracked))] font-mono font-semibold',
} as const
