import { describe, expect, test } from 'bun:test'
import { CURRENT_ONBOARDING_VERSION, hasCompletedCurrentOnboarding, normalizeThemeStyle, THEME_STYLES } from './settings'

describe('normalizeThemeStyle', () => {
  test('Given 历史主题 ID When 归一化 Then 映射至对应新 ASCII 壁纸主题', () => {
    expect(normalizeThemeStyle('ocean-light')).toBe('cloud-drift')
    expect(normalizeThemeStyle('ocean-dark')).toBe('honu-lagoon')
    expect(normalizeThemeStyle('forest-light')).toBe('cloud-drift')
    expect(normalizeThemeStyle('forest-dark')).toBe('fireflies')
    expect(normalizeThemeStyle('slate-light')).toBe('cloud-drift')
    expect(normalizeThemeStyle('slate-dark')).toBe('moonlit')
    expect(normalizeThemeStyle('terminal-dark')).toBe('claude-code')
  })

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
