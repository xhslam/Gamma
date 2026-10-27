import type { ITerminalOptions, ITheme } from '@xterm/xterm'

/** 终端使用独立深色面板，避免 CLI 的 ANSI/truecolor 文字受应用主题影响。 */
export const TERMINAL_BACKGROUND = '#111113'

const TERMINAL_THEME: ITheme = {
  background: TERMINAL_BACKGROUND,
  foreground: '#e6e6e9',
  cursor: '#e6e6e9',
  cursorAccent: TERMINAL_BACKGROUND,
  selectionBackground: '#404964',
  selectionInactiveBackground: '#32394f',
  black: '#23232a',
  red: '#f87171',
  green: '#a3d977',
  yellow: '#e5c07b',
  blue: '#82aaff',
  magenta: '#c792ea',
  cyan: '#89ddff',
  white: '#d4d4dc',
  brightBlack: '#b7b7c0',
  brightRed: '#fca5a5',
  brightGreen: '#bef28d',
  brightYellow: '#f6df9b',
  brightBlue: '#a8c4ff',
  brightMagenta: '#ddb6f2',
  brightCyan: '#b5e9ff',
  brightWhite: '#fafafa',
}

/** 不改写 PTY 输出；由 xterm 对真实背景自动修正 ANSI、256 色和 truecolor 的低对比文字。 */
export function getTerminalAppearanceOptions(): Pick<ITerminalOptions, 'theme' | 'minimumContrastRatio'> {
  return {
    theme: { ...TERMINAL_THEME },
    // xterm 的 dim 分支按一半的阈值修正深灰提示，保留正文和次要文字的层次。
    minimumContrastRatio: 7,
  }
}
