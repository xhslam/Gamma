import type { DesignThemeSnapshot } from '@gamma/shared'
import { parseDesignEditorScope } from './design-browser-policy'

const COLORS = ['background', 'panel', 'inset', 'text', 'secondary', 'tertiary', 'border', 'accent', 'accentText', 'danger', 'ring'] as const

export function parseDesignTheme(input: unknown): DesignThemeSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的 design 主题')
  const value = input as Record<string, unknown>
  if (value.mode !== 'light' && value.mode !== 'dark') throw new Error('无效的 design 主题模式')
  const colors = {} as Pick<DesignThemeSnapshot, typeof COLORS[number]>
  for (const key of COLORS) {
    const color = value[key]
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) throw new Error(`无效的 design 主题颜色: ${key}`)
    colors[key] = color
  }
  if (typeof value.fontFamily !== 'string' || !value.fontFamily.trim() || value.fontFamily.length > 240
    || !/^[\p{L}\p{N}\s,'"._-]+$/u.test(value.fontFamily)) throw new Error('无效的 design UI 字体')
  if (typeof value.radius !== 'number' || !Number.isFinite(value.radius) || value.radius < 0 || value.radius > 32) throw new Error('无效的 design UI 圆角')
  return { mode: value.mode, ...colors, fontFamily: value.fontFamily, radius: value.radius }
}

export function matchesDesignEditorThemeUrl(editorUrl: string, currentUrl: string): boolean {
  try {
    const scope = parseDesignEditorScope(editorUrl)
    const current = new URL(currentUrl)
    return current.origin === scope.origin && !current.username && !current.password && current.pathname === scope.pathname
  } catch { return false }
}

/** 只覆盖原版 CDS 的编辑器外壳变量；不改 color-scheme（避免改变作品 iframe 的媒体查询），不改作品选择器或布局。 */
export function buildDesignThemeCss(input: unknown): string {
  const t = parseDesignTheme(input)
  const vars: Record<string, string> = {
    '--cds-surface-0': t.background, '--cds-surface-1': t.inset,
    '--cds-surface-2': t.panel, '--cds-surface-3': t.panel,
    '--cds-surface-panel': t.panel, '--cds-surface-popover': t.panel, '--cds-page-bg': t.background,
    '--cds-bg-editor-canvas': t.background,
    '--om-bg-canvas': t.background, '--om-bg-hover-opaque': t.inset, '--om-title-ink': '100%',
    '--t-bg': t.background, '--t-panel': t.panel, '--t-bg-warm': t.inset,
    '--t-fg': t.text, '--t-fg-secondary': t.secondary, '--t-fg-muted': t.tertiary,
    '--t-border': t.border, '--t-border-strong': t.secondary,
    '--t-accent': t.accent, '--t-accent-fg': t.accentText, '--t-app-accent': t.accent, '--t-app-accent-fg': t.accentText,
    '--t-ink': t.accent, '--t-ink-hover': t.accent, '--t-ink-fg': t.accentText,
    '--t-blue': t.accent, '--t-blue-text': t.accent,
    '--t-blue-tint': `color-mix(in srgb, ${t.accent} 15%, transparent)`,
    '--cds-text-primary': t.text, '--cds-text-secondary': t.secondary, '--cds-text-muted': t.tertiary,
    '--cds-text-disabled': t.tertiary, '--cds-text-stays-secondary': t.secondary,
    '--cds-border': t.border, '--cds-border-line': t.border, '--cds-border-strong': t.border, '--cds-border-stronger': t.secondary,
    '--cds-fill-primary': t.accent, '--cds-fill-primary-hover': `color-mix(in srgb, ${t.accent} 88%, ${t.text})`,
    '--cds-on-primary': t.accentText, '--cds-fill-accent': t.accent, '--cds-fill-accent-hover': t.accent,
    '--cds-text-accent': t.accent, '--cds-border-accent': t.ring, '--cds-ring-color': t.ring,
    '--cds-fill-secondary': t.inset, '--cds-fill-secondary-hover': t.inset,
    '--cds-fill-control': t.panel, '--cds-fill-control-hover': t.inset, '--cds-fill-field': t.panel,
    '--cds-fill-ghost-hover': t.inset, '--cds-fill-ghost-selected': t.inset,
    '--cds-fill-button-layer': t.panel, '--cds-bg-neutral': t.inset, '--cds-bg-neutral-hover': t.inset,
    '--cds-text-danger': t.danger, '--cds-border-danger': t.danger,
    '--cds-font-sans': t.fontFamily, '--cds-font-sans-display': t.fontFamily,
    '--cds-radius': `${t.radius}px`, '--cds-shadow-sm': 'none', '--cds-shadow-md': 'none',
    '--cds-shadow-lg': 'none', '--cds-shadow-popover': `0 0 0 1px ${t.border}`,
  }
  return `/* Gamma design chrome only; never persist into artwork. */\n:root.cds-root, :root.cds-root .cds-root {\n${Object.entries(vars).map(([key, value]) => `${key}: ${value} !important;`).join('\n')}\n}`
}
