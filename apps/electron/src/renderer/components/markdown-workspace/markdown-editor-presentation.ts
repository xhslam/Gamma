import type { CSSProperties } from 'react'
import type { MarkdownEditorPreferences } from '@gamma/shared'

interface EditorStyle extends CSSProperties { [key: `--${string}`]: string | number }
interface DocumentTheme { id: MarkdownEditorPreferences['theme']; label: string; background: string; surface: string; text: string; secondary: string; accent: string; border: string; dark: boolean }
// 配色基于 xiaolai/vmark 的主题令牌；Copyright (c) 2026 Xiaolai Li，ISC 许可见 vmark/LICENSE。
export const MARKDOWN_DOCUMENT_THEMES: DocumentTheme[] = [
  { id: 'white', label: '白色', background: '#FFFFFF', surface: '#eeeeee', text: '#1a1a1a', secondary: '#666666', accent: '#0065ca', border: '#eeeeee', dark: false },
  { id: 'paper', label: '纸张', background: '#EEEDED', surface: '#dedddd', text: '#1a1a1a', secondary: '#5e5e5e', accent: '#005cb9', border: '#d5d4d4', dark: false },
  { id: 'mint', label: '薄荷', background: '#CCE6D0', surface: '#b8d9bd', text: '#2d3a35', secondary: '#4f4f4f', accent: '#165a3e', border: '#a8c9ad', dark: false },
  { id: 'sepia', label: '棕褐色', background: '#F9F0DB', surface: '#ebdfc2', text: '#5c4b37', secondary: '#5c5c5c', accent: '#8b4513', border: '#e0d5bc', dark: false },
  { id: 'night', label: '夜间', background: '#23262b', surface: '#2e323a', text: '#d6d9de', secondary: '#a2a8ad', accent: '#61abff', border: '#3a3f46', dark: true },
  { id: 'solarized', label: 'Solarized', background: '#002b36', surface: '#073642', text: '#93a1a1', secondary: '#91a0a2', accent: '#53a4de', border: '#0e4753', dark: true },
]
function hsl(hex: string): string {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = rgb as [number, number, number]
  const max = Math.max(...rgb); const min = Math.min(...rgb); const delta = max - min; const lightness = (max + min) / 2
  const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  return `${hue.toFixed(2)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(2)}%`
}
export function markdownThemeStyle(id: MarkdownEditorPreferences['theme']): EditorStyle {
  const theme = MARKDOWN_DOCUMENT_THEMES.find(item => item.id === id)
  if (!theme) return {}
  return { colorScheme: theme.dark ? 'dark' : 'light', '--background': hsl(theme.background), '--foreground': hsl(theme.text), '--muted': hsl(theme.surface), '--muted-foreground': hsl(theme.secondary), '--accent': hsl(theme.surface), '--accent-foreground': hsl(theme.text), '--primary': hsl(theme.accent), '--primary-foreground': hsl(theme.background), '--ring': hsl(theme.accent), '--border': hsl(theme.border), '--input': hsl(theme.border), '--popover': hsl(theme.background), '--popover-foreground': hsl(theme.text), '--dialog': hsl(theme.background), '--dialog-foreground': hsl(theme.text) }
}
export function markdownEditorStyle(preferences: MarkdownEditorPreferences): EditorStyle {
  const latin = { system: '-apple-system, BlinkMacSystemFont', serif: 'Georgia, "Times New Roman"', sans: 'Arial, Helvetica' }[preferences.latinFont]
  const cjk = { system: '"PingFang SC", "Microsoft YaHei"', song: '"Songti SC", "Noto Serif CJK SC", SimSun', hei: '"Heiti SC", "Noto Sans CJK SC", SimHei', kai: '"Kaiti SC", KaiTi, STKaiti' }[preferences.cjkFont]
  const mono = { system: 'ui-monospace, SFMono-Regular, Consolas', menlo: 'Menlo, Consolas', monaco: 'Monaco, Consolas' }[preferences.monoFont]
  return { ...markdownThemeStyle(preferences.theme), '--md-editor-font': `${latin}, ${cjk}, sans-serif`, '--md-editor-mono': `${mono}, monospace`, '--md-editor-size': `${preferences.fontSize}px`, '--md-editor-line-height': preferences.lineHeight, '--md-editor-spacing': preferences.blockSpacing, '--md-editor-letter-spacing': `${preferences.letterSpacing}em`, '--md-editor-width': preferences.contentWidth === 0 ? '100%' : `${preferences.contentWidth}em`, '--md-editor-heading-align': preferences.headingAlign }
}
export function markdownShortcutMatches(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, accelerator: string): boolean {
  const parts = accelerator.split('+'); const key = parts.pop() ?? ''
  return event.key.toLowerCase() === key.toLowerCase() && (event.metaKey || event.ctrlKey) === parts.includes('Mod') && event.shiftKey === parts.includes('Shift') && event.altKey === parts.includes('Alt')
}
