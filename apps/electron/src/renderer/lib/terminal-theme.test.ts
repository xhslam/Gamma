import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'bun:test'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import type { ITerminalOptions } from '@xterm/xterm'
import { getTerminalAppearanceOptions as readTerminalAppearanceOptions } from './terminal-theme'
import type { DesignColorReader } from './design-colors'

const tokens = readFileSync(resolve(import.meta.dir, '../styles/design-tokens.css'), 'utf8')
const darkColor: DesignColorReader = (role) => {
  const name = role === 'accent' ? 'accent' : `dark-${role}`
  const value = tokens.match(new RegExp(`--palette-${name}: (#[a-fA-F0-9]{6});`))?.[1]
  if (!value) throw new Error(`测试缺少颜色令牌：${role}`)
  return value.toLowerCase()
}
const getTerminalAppearanceOptions = () => readTerminalAppearanceOptions(darkColor)
const TERMINAL_BACKGROUND = darkColor('panel')

interface RenderedSpan {
  className: string
  textContent: string
  style: Record<string, string>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

interface TestColor {
  css: string
  rgba: number
}

interface TestColors {
  foreground: TestColor
  background: TestColor
  selectionBackgroundOpaque: TestColor
  ansi: TestColor[]
}

interface TestCell {
  fg: number
  bg: number
}

interface TestLine {
  setCell(index: number, cell: TestCell): void
}

interface TestRenderer {
  createRow(...args: unknown[]): RenderedSpan[]
  handleSelectionChanged(start: [number, number], end: [number, number], columnSelectMode: boolean): void
}

interface XtermRenderModule {
  OptionsService: new (options: ITerminalOptions) => unknown
  ThemeService: new (options: unknown) => { colors: TestColors; dispose(): void }
  DomRendererRowFactory: new (...args: unknown[]) => TestRenderer
  CellData: { fromCharData(data: [number, string, number, number]): TestCell }
  BufferLine: new (cols: number) => TestLine
  Attributes: { CM_P16: number; CM_P256: number; CM_RGB: number }
  FgFlags: { INVERSE: number }
  BgFlags: { DIM: number }
}

let xterm: XtermRenderModule

beforeAll(async () => {
  // 执行应用当前安装的 xterm 渲染器，避免仅检查配置值却遗漏真实渲染回归。
  const sourceRoot = resolve(dirname(require.resolve('@xterm/xterm/package.json')), 'src')
  const result = await build({
    stdin: {
      contents: [
        "export { DomRendererRowFactory } from 'browser/renderer/dom/DomRendererRowFactory';",
        "export { ThemeService } from 'browser/services/ThemeService';",
        "export { OptionsService } from 'common/services/OptionsService';",
        "export { BufferLine } from 'common/buffer/BufferLine';",
        "export { CellData } from 'common/buffer/CellData';",
        "export { Attributes, FgFlags, BgFlags } from 'common/buffer/Constants';",
      ].join('\n'),
      loader: 'ts',
    },
    alias: { common: resolve(sourceRoot, 'common'), browser: resolve(sourceRoot, 'browser'), vs: resolve(sourceRoot, 'vs') },
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0]!.text, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance,
    process: { title: 'terminal-theme-test' },
    document: { createElement: () => ({ style: {}, getContext: () => null }) },
    navigator: { platform: 'MacIntel', userAgent: 'Terminal regression test', language: 'zh-CN' },
  })
  xterm = module.exports as XtermRenderModule
})

function createSpan(): RenderedSpan {
  const attributes = new Map<string, string>()
  return {
    className: '', textContent: '', style: {},
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => { attributes.set(name, value) },
  }
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

function renderCell(options: ITerminalOptions, foreground = 0, background = 0, selected = false, char = 'A') {
  const optionsService = new xterm.OptionsService(options)
  const themeService = new xterm.ThemeService(optionsService)
  const renderer = new xterm.DomRendererRowFactory(
    { createElement: createSpan },
    { getJoinedCharacters: () => [] },
    optionsService,
    { isFocused: true },
    { isCursorHidden: true },
    { forEachDecorationAtCell: () => {} },
    themeService,
  )
  const line = new xterm.BufferLine(1)
  const cell = xterm.CellData.fromCharData([foreground, char, 1, char.codePointAt(0)!])
  cell.bg = background
  line.setCell(0, cell)
  if (selected) renderer.handleSelectionChanged([0, 0], [1, 0], false)
  const span = renderer.createRow(line, 0, false, undefined, undefined, 0, false, 8, { get: () => 8 }, -1, -1)[0]!
  const inlineColor = span.getAttribute('style')?.match(/(?:^|;)color:(#[0-9a-f]{6})/i)?.[1]
  const ansiColor = span.className.match(/xterm-fg-(\d+)/)?.[1]
  const resolvedForeground = inlineColor ?? (ansiColor === '257'
    ? themeService.colors.background.css
    : ansiColor ? themeService.colors.ansi[Number(ansiColor)]!.css : themeService.colors.foreground.css)
  const ansiBackground = span.className.match(/xterm-bg-(\d+)/)?.[1]
  const resolvedBackground = selected
    ? themeService.colors.selectionBackgroundOpaque.css
    : span.getAttribute('style')?.match(/background-color:(#[0-9a-f]{6})/i)?.[1] ?? (ansiBackground === '257'
      ? themeService.colors.foreground.css
      : ansiBackground ? themeService.colors.ansi[Number(ansiBackground)]!.css : themeService.colors.background.css)
  const colors = themeService.colors
  themeService.dispose()
  return { foreground: resolvedForeground, background: resolvedBackground, span, colors }
}

describe('终端文字对比度', () => {
  test('Given 应用深色主题 When 使用设计令牌终端色面 Then 正文和光标都清晰可辨', () => {
    const options = getTerminalAppearanceOptions()
    const rendered = renderCell(options)
    expect(rendered.background).toBe(TERMINAL_BACKGROUND)
    expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(7)
    expect(contrast(options.theme!.cursor!, options.theme!.cursorAccent!)).toBeGreaterThanOrEqual(7)
  })

  test('Given CLI 输出与深底接近的 truecolor When 渲染正文 Then 自动提高实际文字对比度', () => {
    const rendered = renderCell(getTerminalAppearanceOptions(), xterm.Attributes.CM_RGB | 0x18181b)
    expect(contrast('#18181b', rendered.background)).toBeLessThan(1.3)
    expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(7)
  })

  test('Given CLI 使用 ANSI 黑色或 256 色深灰 When 渲染文字 Then 均得到可读前景', () => {
    for (const foreground of [xterm.Attributes.CM_P16, xterm.Attributes.CM_P256 | 232]) {
      const rendered = renderCell(getTerminalAppearanceOptions(), foreground)
      expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(7)
    }
  })

  test('Given CLI 使用浅色背景及低对比文字 When 渲染 Then 自动加深前景且保留背景', () => {
    const rendered = renderCell(getTerminalAppearanceOptions(), xterm.Attributes.CM_RGB | 0xe0e0e0, xterm.Attributes.CM_RGB | 0xfafafa)
    expect(rendered.background).toBe('#fafafa')
    expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(7)
  })

  test('Given 低对比 truecolor dim 提示 When 渲染 Then 修正该文字颜色并保留 dim 标记', () => {
    const rendered = renderCell(getTerminalAppearanceOptions(), xterm.Attributes.CM_RGB | 0x18181b, xterm.BgFlags.DIM)
    expect(rendered.span.className).toContain('xterm-dim')
    expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(3.5)
  })

  test('Given 深灰正文被选中 When 绘制选区 Then 根据选区真实背景矫正前景', () => {
    const rendered = renderCell(getTerminalAppearanceOptions(), xterm.Attributes.CM_RGB | 0x18181b, 0, true)
    expect(rendered.background).not.toBe(TERMINAL_BACKGROUND)
    expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(7)
  })

  test('Given CLI 反色强调 When 渲染 Then 保持明暗关系与清晰文字', () => {
    const rendered = renderCell(getTerminalAppearanceOptions(), xterm.FgFlags.INVERSE)
    expect(rendered.background).toBe(getTerminalAppearanceOptions().theme!.foreground!)
    expect(contrast(rendered.foreground, rendered.background)).toBeGreaterThanOrEqual(7)
  })

  test('Given CLI 使用块字符绘制背景 When 修正文字对比度 Then 保留图形本身的颜色', () => {
    const rendered = renderCell(getTerminalAppearanceOptions(), xterm.Attributes.CM_RGB | 0x18181b, 0, false, '█')
    expect(rendered.foreground).toBe('#18181b')
  })
})
