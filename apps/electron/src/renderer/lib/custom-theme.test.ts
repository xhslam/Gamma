import { describe, expect, test } from 'bun:test'
import { DEFAULT_CUSTOM_THEME } from '../../types'
import { customThemeCssVariables, hexToHslChannels, resolveCustomThemeMode } from './custom-theme'

describe('自定义主题令牌', () => {
  test('Given 深浅两种背景 When 计算组件语义 Then 分别使用深色和浅色模式', () => {
    expect(resolveCustomThemeMode(DEFAULT_CUSTOM_THEME)).toBe('dark')
    expect(resolveCustomThemeMode({ ...DEFAULT_CUSTOM_THEME, background: '#FAF9F5', foreground: '#141413' })).toBe('light')
  })

  test('Given 三项自定义颜色 When 派生设计令牌 Then 保留用户颜色并生成完整表面层级', () => {
    const variables = customThemeCssVariables({
      accent: '#458588',
      background: '#282828',
      foreground: '#EBDBB2',
    })
    expect(variables['--background']).toBe('0.00 0.00% 15.69%')
    expect(variables['--color-background']).toBe('#282828')
    expect(variables['--color-accent']).toBe('#458588')
    expect(variables['--color-text']).toBe('#EBDBB2')
    expect(variables['--color-panel']).not.toBe(variables['--color-background'])
    expect(variables['--color-inset']).not.toBe(variables['--color-panel'])
    expect(variables['--border']).toBe(`${variables['--foreground']} / 0.14`)
  })

  test('Given 无彩色 When 转换 HSL Then 不生成无效色相或饱和度', () => {
    expect(hexToHslChannels('#000000')).toBe('0.00 0.00% 0.00%')
    expect(hexToHslChannels('#FFFFFF')).toBe('0.00 0.00% 100.00%')
  })
})
