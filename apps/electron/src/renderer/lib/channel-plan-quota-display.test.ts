import { describe, expect, test } from 'bun:test'
import type { ChannelPlanQuotaResult } from '@carpus/shared'
import { formatPlanQuotaResetCountdown, getPlanQuotaPillDisplay } from './channel-plan-quota-display'

const NOW = Date.UTC(2026, 10, 21, 8, 0, 0)

function codexQuota(overrides?: Partial<ChannelPlanQuotaResult>): ChannelPlanQuotaResult {
  return {
    supported: true,
    provider: 'openai-codex',
    planName: 'ChatGPT Pro',
    updatedAt: NOW,
    windows: [
      { type: '5h', label: '5 小时窗口', remainingPercent: 100, usedPercent: 0, resetAt: NOW + 5 * 3_600_000 },
      { type: 'weekly', label: '每周窗口', remainingPercent: 100, usedPercent: 0, resetAt: NOW + 7 * 86_400_000 },
    ],
    ...overrides,
  }
}

describe('订阅额度重置倒计时', () => {
  test('given 5 hours until reset when formatting countdown then shows hours', () => {
    expect(formatPlanQuotaResetCountdown(NOW + 5 * 3_600_000, NOW)).toBe('5h')
  })

  test('given 7 days until reset when formatting countdown then shows days', () => {
    expect(formatPlanQuotaResetCountdown(NOW + 7 * 86_400_000, NOW)).toBe('7天')
  })

  test('given less than one hour until reset when formatting countdown then shows minutes', () => {
    expect(formatPlanQuotaResetCountdown(NOW + 30 * 60_000, NOW)).toBe('30m')
  })

  test('given reset already passed when formatting countdown then returns null', () => {
    expect(formatPlanQuotaResetCountdown(NOW - 1000, NOW)).toBeNull()
  })

  test('given missing reset time when formatting countdown then returns null', () => {
    expect(formatPlanQuotaResetCountdown(undefined, NOW)).toBeNull()
  })
})

describe('订阅额度胶囊摘要', () => {
  test('given codex quota with both windows when building pill display then shows 5H and weekly with countdowns', () => {
    const display = getPlanQuotaPillDisplay(codexQuota(), 'openai-codex', NOW)

    expect(display?.summary).toBe('5H 100% · 5h ｜ 周 100% · 7天')
    expect(display?.muted).toBe(false)
    expect(display?.lowQuota).toBe(false)
    expect(display?.title).toContain('ChatGPT Pro')
  })

  test('given window without reset time when building pill display then omits countdown segment', () => {
    const quota = codexQuota({
      windows: [{ type: '5h', label: '5 小时窗口', remainingPercent: 80, usedPercent: 20 }],
    })

    expect(getPlanQuotaPillDisplay(quota, 'openai-codex', NOW)?.summary).toBe('5H 80%')
  })

  test('given remaining percent at or below 20 when building pill display then flags low quota', () => {
    const quota = codexQuota({
      windows: [
        { type: '5h', label: '5 小时窗口', remainingPercent: 15, usedPercent: 85, resetAt: NOW + 3_600_000 },
        { type: 'weekly', label: '每周窗口', remainingPercent: 90, usedPercent: 10, resetAt: NOW + 7 * 86_400_000 },
      ],
    })

    expect(getPlanQuotaPillDisplay(quota, 'openai-codex', NOW)?.lowQuota).toBe(true)
  })

  test('given balance-style remaining label when building pill display then uses the label instead of percent', () => {
    const quota: ChannelPlanQuotaResult = {
      supported: true,
      provider: 'deepseek',
      updatedAt: NOW,
      windows: [{ type: 'custom', label: '余额', remainingPercent: 0, usedPercent: 0, remainingLabel: '¥12.34', showProgress: false }],
    }

    const display = getPlanQuotaPillDisplay(quota, 'deepseek', NOW)
    expect(display?.summary).toBe('余额 ¥12.34')
    expect(display?.lowQuota).toBe(false)
  })

  test('given unsupported non-copilot channel when building pill display then returns null', () => {
    const quota: ChannelPlanQuotaResult = {
      supported: false,
      provider: 'custom',
      windows: [],
      updatedAt: NOW,
      message: '当前渠道不支持订阅 Plan 额度查询',
    }

    expect(getPlanQuotaPillDisplay(quota, 'custom', NOW)).toBeNull()
  })

  test('given copilot quota still loading when building pill display then shows muted loading state', () => {
    const display = getPlanQuotaPillDisplay(null, 'github-copilot', NOW)

    expect(display?.summary).toBe('额度加载中')
    expect(display?.muted).toBe(true)
  })

  test('given copilot quota unavailable when building pill display then shows muted unavailable state', () => {
    const quota: ChannelPlanQuotaResult = {
      supported: false,
      provider: 'github-copilot',
      windows: [],
      updatedAt: NOW,
      message: '未提供可用额度数据',
    }

    const display = getPlanQuotaPillDisplay(quota, 'github-copilot', NOW)
    expect(display?.summary).toBe('额度不可用')
    expect(display?.muted).toBe(true)
  })

  test('given null quota for non-copilot provider when building pill display then returns null', () => {
    expect(getPlanQuotaPillDisplay(null, 'openai-codex', NOW)).toBeNull()
  })
})