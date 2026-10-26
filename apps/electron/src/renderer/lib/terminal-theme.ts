import type { ITerminalOptions, ITheme } from '@xterm/xterm'
import { readDesignColor } from './design-colors'
import type { DesignColorReader } from './design-colors'

/** 外壳可直接使用 CSS 变量；xterm 的具体色值由读取器解析。 */
export const TERMINAL_BACKGROUND = 'var(--color-background)'

/** 不改写 PTY 输出；只统一终端默认表面、光标、选区和 ANSI 基色。 */
export function getTerminalAppearanceOptions(readColor: DesignColorReader = readDesignColor): Pick<ITerminalOptions, 'theme' | 'minimumContrastRatio'> {
  const background = readColor('background')
  const text = readColor('text')
  const secondary = readColor('secondary')
  const accent = readColor('accent')
  const inset = readColor('inset')
  const theme: ITheme = {
    background,
    foreground: text,
    cursor: text,
    cursorAccent: background,
    selectionBackground: inset,
    selectionInactiveBackground: inset,
    black: background,
    red: accent,
    green: secondary,
    yellow: accent,
    blue: secondary,
    magenta: accent,
    cyan: secondary,
    white: text,
    brightBlack: secondary,
    brightRed: accent,
    brightGreen: text,
    brightYellow: accent,
    brightBlue: text,
    brightMagenta: accent,
    brightCyan: text,
    brightWhite: text,
  }
  return {
    theme,
    // CLI truecolor 是用户内容，仍由 xterm 修正过低对比度，不重写输出。
    minimumContrastRatio: 7,
  }
}
