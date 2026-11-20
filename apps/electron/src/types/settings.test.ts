import { describe, expect, test } from 'bun:test'
import { CURRENT_ONBOARDING_VERSION, DEFAULT_CUSTOM_THEME, hasCompletedCurrentOnboarding, normalizeCustomTheme, normalizeThemeAppearance, normalizeThemeStyle, THEME_STYLES } from './settings'

describe('normalizeThemeStyle', () => {
  test('Given 有效新主题 ID When 归一化 Then 原样保留', () => {
    for (const style of THEME_STYLES) {
      expect(normalizeThemeStyle(style)).toBe(style)
    }
  })

  test('Given 非法或空值 When 归一化 Then 回退至 default', () => {
    expect(normalizeThemeStyle(undefined)).toBe('default')
    expect(normalizeThemeStyle('invalid-style')).toBe('default')
    expect(normalizeThemeStyle(null)).toBe('default')
  })
})

describe('normalizeThemeAppearance', () => {
  test('Given 旧版特殊风格 When 升级 Then 保留配色基调和已有 ASCII 壁纸', () => {
    expect(normalizeThemeAppearance({ themeMode: 'special', themeStyle: 'cloud-drift' }))
      .toEqual({ themeMode: 'light', themeStyle: 'default', chatWallpaper: 'cloud-drift', customTheme: DEFAULT_CUSTOM_THEME })
    expect(normalizeThemeAppearance({ themeMode: 'special', themeStyle: 'moonlit' }))
      .toEqual({ themeMode: 'dark', themeStyle: 'default', chatWallpaper: 'moonlit', customTheme: DEFAULT_CUSTOM_THEME })
    expect(normalizeThemeAppearance({ themeMode: 'special', themeStyle: 'ocean-light' }))
      .toEqual({ themeMode: 'light', themeStyle: 'default', chatWallpaper: 'default', customTheme: DEFAULT_CUSTOM_THEME })
  })

  test('Given 已关闭壁纸 When 重载已有特殊风格的配置 Then 继续关闭壁纸', () => {
    const settings = normalizeThemeAppearance({ themeMode: 'special', themeStyle: 'cloud-drift', chatWallpaper: 'default' })
    expect(normalizeThemeAppearance(settings)).toEqual({ themeMode: 'light', themeStyle: 'default', chatWallpaper: 'default', customTheme: DEFAULT_CUSTOM_THEME })
  })

  test('Given 自定义模式和部分非法颜色 When 归一化 Then 保留模式、合法颜色并回退非法字段', () => {
    expect(normalizeThemeAppearance({
      themeMode: 'custom',
      customTheme: { accent: '#a1b2c3', background: 'not-a-color', foreground: '#EBDBB2' },
    })).toEqual({
      themeMode: 'custom',
      themeStyle: 'default',
      chatWallpaper: 'default',
      customTheme: { accent: '#A1B2C3', background: DEFAULT_CUSTOM_THEME.background, foreground: '#EBDBB2' },
    })
  })
})

describe('normalizeCustomTheme', () => {
  test('Given 非对象或缺少字段 When 归一化 Then 返回完整默认配色', () => {
    expect(normalizeCustomTheme(undefined)).toEqual(DEFAULT_CUSTOM_THEME)
    expect(normalizeCustomTheme({ accent: '#FFF' })).toEqual(DEFAULT_CUSTOM_THEME)
  })
})

describe('Onboarding completion version', () => {
  test('Given an existing completed installation without a version When checking Then requires the new onboarding', () => {
    expect(hasCompletedCurrentOnboarding({ onboardingCompleted: true })).toBe(false)
  })

  test('Given the current version is completed When checking Then does not show onboarding again', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    })).toBe(true)
  })

  test('Given a newer version is completed When checking after a rollback Then does not show an older onboarding', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION + 1,
    })).toBe(true)
  })

  test('Given the current version is not completed When checking Then shows onboarding', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: false,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    })).toBe(false)
  })
})
