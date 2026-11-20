import { normalizeCustomTheme, type CustomThemeColors } from '../../types'

interface RgbColor {
  r: number
  g: number
  b: number
}

function hexToRgb(hex: string): RgbColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const channel = (value: number): string => Math.round(value).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

function mixColor(from: string, to: string, amount: number): string {
  const source = hexToRgb(from)
  const target = hexToRgb(to)
  return rgbToHex({
    r: source.r + (target.r - source.r) * amount,
    g: source.g + (target.g - source.g) * amount,
    b: source.b + (target.b - source.b) * amount,
  })
}

/** 将颜色转换为现有设计令牌使用的 HSL 通道格式。 */
export function hexToHslChannels(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  let hue = 0
  let saturation = 0

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1))
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360

  return `${hue.toFixed(2)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(2)}%`
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const linearize = (channel: number): number => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return linearize(r) * 0.2126 + linearize(g) * 0.7152 + linearize(b) * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

/** 自定义背景决定浅色/深色组件语义，避免代码块和浮层沿用错误配色。 */
export function resolveCustomThemeMode(colors: CustomThemeColors): 'light' | 'dark' {
  return relativeLuminance(normalizeCustomTheme(colors).background) < 0.35 ? 'dark' : 'light'
}

/** 从三项用户颜色派生完整语义令牌，保持现有组件无需增加分支。 */
export function customThemeCssVariables(input: CustomThemeColors): Record<string, string> {
  const colors = normalizeCustomTheme(input)
  const mode = resolveCustomThemeMode(colors)
  const panel = mixColor(colors.background, colors.foreground, mode === 'dark' ? 0.04 : 0.025)
  const inset = mixColor(colors.background, colors.foreground, mode === 'dark' ? 0.09 : 0.06)
  const secondary = mixColor(colors.foreground, colors.background, 0.25)
  const tertiary = mixColor(colors.foreground, colors.background, 0.45)
  const foreground = hexToHslChannels(colors.foreground)
  const primaryForeground = contrastRatio(colors.accent, '#141413') >= contrastRatio(colors.accent, '#F0EEE6')
    ? '#141413'
    : '#F0EEE6'

  return {
    '--background': hexToHslChannels(colors.background),
    '--foreground': foreground,
    '--panel': hexToHslChannels(panel),
    '--inset': hexToHslChannels(inset),
    '--text-secondary': hexToHslChannels(secondary),
    '--text-tertiary': hexToHslChannels(tertiary),
    '--border': `${foreground} / 0.14`,
    '--primary': hexToHslChannels(colors.accent),
    '--primary-foreground': hexToHslChannels(primaryForeground),
    '--background-interaction': hexToHslChannels(colors.accent),
    '--color-background': colors.background,
    '--color-panel': panel,
    '--color-inset': inset,
    '--color-text': colors.foreground,
    '--color-secondary': secondary,
    '--color-tertiary': tertiary,
    '--color-accent': colors.accent,
    '--color-border': `hsl(${foreground} / 0.14)`,
  }
}
