import type { CSSProperties } from 'react'
import type { MarkdownEditorPreferences } from '@gamma/shared'

interface EditorStyle extends CSSProperties { [key: `--${string}`]: string | number }
interface DocumentTheme { id: MarkdownEditorPreferences['theme']; label: string; background: string; surface: string; text: string; secondary: string; accent: string; border: string; dark: boolean }
function documentTheme(id: DocumentTheme['id'], label: string, dark: boolean): DocumentTheme {
  const prefix = `--palette-${dark ? 'dark' : 'light'}`
  return { id, label, dark, background: `var(${prefix}-background)`, surface: `var(${prefix}-inset)`, text: `var(${prefix}-text)`, secondary: `var(${prefix}-secondary)`, accent: 'var(--palette-accent)', border: `hsl(var(${dark ? '--palette-light-background' : '--palette-light-text'}-hsl) / 0.08)` }
}
export const MARKDOWN_DOCUMENT_THEMES: DocumentTheme[] = [
  documentTheme('white', '白色', false),
  documentTheme('paper', '纸张', false),
  documentTheme('mint', '薄荷', false),
  documentTheme('sepia', '棕褐色', false),
  documentTheme('night', '夜间', true),
  documentTheme('solarized', 'Solarized', true),
]
export function markdownThemeStyle(id: MarkdownEditorPreferences['theme']): EditorStyle {
  const theme = MARKDOWN_DOCUMENT_THEMES.find(item => item.id === id)
  if (!theme) return {}
  const prefix = `--palette-${theme.dark ? 'dark' : 'light'}`
  const channel = (role: string): string => `var(${prefix}-${role}-hsl)`
  const foreground = channel('text')
  const surface = channel('inset')
  const background = channel('background')
  const panel = channel('panel')
  const primary = 'var(--palette-accent-hsl)'
  const border = `var(${theme.dark ? '--palette-light-background' : '--palette-light-text'}-hsl) / 0.08`
  return {
    colorScheme: theme.dark ? 'dark' : 'light',
    '--color-background': theme.background, '--color-panel': `var(${prefix}-panel)`, '--color-inset': theme.surface,
    '--color-text': theme.text, '--color-secondary': theme.secondary, '--color-tertiary': `var(${prefix}-tertiary)`,
    '--color-accent': theme.accent,
    '--background': background, '--foreground': foreground, '--panel': panel,
    '--muted': surface, '--inset': surface, '--muted-foreground': channel('secondary'),
    '--tertiary-foreground': channel('tertiary'), '--accent': surface, '--accent-foreground': foreground,
    '--primary': primary, '--primary-foreground': 'var(--palette-light-text-hsl)', '--ring': primary,
    '--border': border, '--color-border': `hsl(${border})`, '--input': border,
    '--card': panel, '--card-foreground': foreground, '--popover': panel, '--popover-foreground': foreground,
    '--dialog': panel, '--dialog-foreground': foreground, '--secondary': surface, '--secondary-foreground': foreground,
    '--code-bg': surface, '--code-foreground': foreground, '--syntax-text': `hsl(${foreground})`,
    '--syntax-secondary': `hsl(${channel('secondary')})`, '--syntax-accent': `hsl(${primary})`,
  }
}
export function markdownEditorStyle(preferences: MarkdownEditorPreferences): EditorStyle {
  const latin = { system: '"Source Serif 4"', serif: '"Source Serif 4"', sans: '"Inter Variable", Inter' }[preferences.latinFont]
  const cjk = { system: '"Noto Serif SC", "Songti SC"', song: '"Noto Serif SC", "Songti SC"', hei: '"Heiti SC", "Noto Sans CJK SC", SimHei', kai: '"Kaiti SC", KaiTi, STKaiti' }[preferences.cjkFont]
  const mono = { system: 'ui-monospace, SFMono-Regular, Consolas', menlo: 'Menlo, Consolas', monaco: 'Monaco, Consolas' }[preferences.monoFont]
  return { ...markdownThemeStyle(preferences.theme), '--md-editor-font': `${latin}, ${cjk}, ${preferences.latinFont === 'sans' ? 'sans-serif' : 'serif'}`, '--md-editor-mono': `${mono}, monospace`, '--md-editor-size': `${preferences.fontSize}px`, '--md-editor-line-height': preferences.lineHeight, '--md-editor-spacing': preferences.blockSpacing, '--md-editor-letter-spacing': `${preferences.letterSpacing}em`, '--md-editor-width': preferences.contentWidth === 0 ? '100%' : `${preferences.contentWidth}em`, '--md-editor-heading-align': preferences.headingAlign }
}
export function markdownShortcutMatches(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, accelerator: string): boolean {
  const parts = accelerator.split('+'); const key = parts.pop() ?? ''
  return event.key.toLowerCase() === key.toLowerCase() && (event.metaKey || event.ctrlKey) === parts.includes('Mod') && event.shiftKey === parts.includes('Shift') && event.altKey === parts.includes('Alt')
}
