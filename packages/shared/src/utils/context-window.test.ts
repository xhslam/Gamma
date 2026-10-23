/**
 * Item 9 测试：统一保守窗口
 *
 * 验证 inferBudgetContextWindow 与 CONSERVATIVE_FALLBACK_CONTEXT_WINDOW 的行为：
 * - 未知模型 → 128k 保守兜底
 * - 已知模型（Claude/GPT/Gemini 等）→ 权威 registry 值
 * - 运行时实测值优先级最高
 * - 80k A 绝对上限仍有效（此函数不影响上限，只影响分母）
 */

import { describe, expect, it } from 'bun:test'
import {
  inferBudgetContextWindow,
  inferContextWindow,
  CONSERVATIVE_FALLBACK_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
} from './context-window'

describe('inferBudgetContextWindow (Item 9)', () => {
  it('未知模型时返回保守兜底 128k，不使用 200k', () => {
    const result = inferBudgetContextWindow('some-future-unknown-model-xyz')
    expect(result).toBe(CONSERVATIVE_FALLBACK_CONTEXT_WINDOW)
    expect(result).toBe(128_000)
    // 确认不是 DEFAULT_CONTEXT_WINDOW（200k）
    expect(result).not.toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('undefined modelId 时返回保守兜底 128k', () => {
    const result = inferBudgetContextWindow(undefined)
    expect(result).toBe(128_000)
  })

  it('空字符串 modelId 时返回保守兜底 128k', () => {
    const result = inferBudgetContextWindow('')
    expect(result).toBe(128_000)
  })

  it('已知 Claude 1M 模型时返回 1,000,000', () => {
    const result = inferBudgetContextWindow('claude-sonnet-4-6')
    expect(result).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })

  it('已知 Codex GPT-5.4 模型时返回权威 registry 值', () => {
    const result = inferBudgetContextWindow('gpt-5.4')
    const expected = inferContextWindow('gpt-5.4')!
    expect(result).toBe(expected)
    expect(result).toBeGreaterThan(128_000)
  })

  it('运行时实测值优先级最高，覆盖 registry 推断', () => {
    // 即使已知模型，实测值也优先
    const measured = 150_000
    const result = inferBudgetContextWindow('claude-sonnet-4-6', measured)
    expect(result).toBe(measured)
  })

  it('实测值为 0 时不优先，回退到推断值', () => {
    const result = inferBudgetContextWindow('gpt-5.4', 0)
    // 0 视为无效，使用推断值
    const expected = inferContextWindow('gpt-5.4')!
    expect(result).toBe(expected)
  })

  it('CONSERVATIVE_FALLBACK_CONTEXT_WINDOW 常量值为 128,000', () => {
    expect(CONSERVATIVE_FALLBACK_CONTEXT_WINDOW).toBe(128_000)
  })

  it('UI 与主进程使用同一函数时预算一致（35% 比例）', () => {
    const uiBudget = Math.floor(inferBudgetContextWindow('unknown-model-abc') * 0.35)
    const mainBudget = Math.floor(inferBudgetContextWindow('unknown-model-abc') * 0.35)
    expect(uiBudget).toBe(mainBudget)
    // 128k * 35% = 44,800
    expect(uiBudget).toBe(Math.floor(128_000 * 0.35))
  })
})
