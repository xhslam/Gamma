import { describe, expect, test } from 'bun:test'
import { isGpt62Model } from './model-family'
import { inferCodexAlignedGPT5ContextWindow } from './context-window'
import { resolveReasoningProfile } from '../types/reasoning-profile'

describe('GPT-6.2 精确能力边界', () => {
  for (const [id, context] of [['gpt-6.2-astra', 272_000], ['gpt-6.2-sol', 500_000]] as const) {
    test(`Given ${id} When 解析型号及推理 Then 采用 Codex 窗口且关闭推理降为 low`, () => {
      expect(isGpt62Model(` ${id.toUpperCase()}[1m] `)).toBe(true)
      expect(inferCodexAlignedGPT5ContextWindow(id)).toBe(context)
      for (const transport of ['openai-responses', 'openai-completions'] as const) {
        const profile = resolveReasoningProfile({ modelId: id, transport })
        expect(profile?.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
        expect(profile?.normalize('off')).toBe('low')
        expect(profile?.encodings[transport]?.effortMap?.off).toBe('low')
      }
    })
  }
  test('Given 邻近型号 When 解析 Then 不推测不存在的 6.2 SKU', () => {
    for (const id of ['gpt-6.2', 'gpt-6.2-terra', 'gpt-6.2-luna', 'gpt-6.2-sol-preview', 'gpt-6.2-astra-mini', 'gpt-6.20-sol']) {
      expect(isGpt62Model(id)).toBe(false)
      expect(resolveReasoningProfile({ modelId: id, transport: 'openai-responses' })).toBeUndefined()
    }
  })
})
