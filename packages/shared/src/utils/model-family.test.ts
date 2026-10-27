import { describe, expect, it } from 'bun:test'
import {
  isGpt6SolFamily,
  isGpt61SolModel,
  isGpt61TerraModel,
} from './model-family'
import {
  isCodexFastModeSupportedModel,
} from '../types/agent'
import {
  inferCodexAlignedGPT5ContextWindow,
  inferBudgetContextWindow,
} from './context-window'
import {
  resolveReasoningProfile,
} from '../types/reasoning-profile'

describe('GPT-6.1 Sol 模型识别与能力基线 (精确匹配)', () => {
  describe('model-family', () => {
    it('isGpt6SolFamily 仅识别精确 gpt-6-sol 与 gpt-6.1-sol', () => {
      expect(isGpt6SolFamily('gpt-6-sol')).toBe(true)
      expect(isGpt6SolFamily('gpt-6.1-sol')).toBe(true)
      expect(isGpt6SolFamily('GPT-6.1-SOL')).toBe(true)
      expect(isGpt6SolFamily(' gpt-6.1-sol ')).toBe(true)
      expect(isGpt6SolFamily('gpt-6.1-sol[1m]')).toBe(true)

      // 邻近非法 ID 及未授权泛化必须被严格拒绝
      expect(isGpt6SolFamily('gpt-6.1-sol-terra')).toBe(false)
      expect(isGpt6SolFamily('gpt-6.1-terra')).toBe(false)
      expect(isGpt6SolFamily('gpt-6-terra')).toBe(false)
      expect(isGpt6SolFamily('gpt-6.2-sol')).toBe(false)
      expect(isGpt6SolFamily('gpt-6.1-sol-mini')).toBe(false)
      expect(isGpt6SolFamily('gpt-6.1')).toBe(false)
      expect(isGpt6SolFamily(undefined)).toBe(false)
    })

    it('isGpt61SolModel 仅精确匹配 gpt-6.1-sol', () => {
      expect(isGpt61SolModel('gpt-6.1-sol')).toBe(true)
      expect(isGpt61SolModel('GPT-6.1-Sol')).toBe(true)
      expect(isGpt61SolModel('gpt-6-sol')).toBe(false)
      expect(isGpt61SolModel('gpt-6.1-sol-terra')).toBe(false)
    })
  })

  describe('Fast Mode 白名单防扩散', () => {
    it('gpt-6.1-sol 不盲目纳入 Fast Mode 白名单', () => {
      // gpt-6-sol 有经证据支持的 Fast Mode
      expect(isCodexFastModeSupportedModel('gpt-6-sol')).toBe(true)
      // 新模型 gpt-6.1-sol 未经证据支持，严禁扩展 Fast Mode
      expect(isCodexFastModeSupportedModel('gpt-6.1-sol')).toBe(false)
      expect(isCodexFastModeSupportedModel('gpt-6.1-sol-terra')).toBe(false)
    })
  })

  describe('上下文窗口基线', () => {
    it('gpt-6.1-sol 与 Pi SDK 的 500k 目录一致', () => {
      expect(inferCodexAlignedGPT5ContextWindow('gpt-6.1-sol')).toBe(500_000)
      expect(inferBudgetContextWindow('gpt-6.1-sol')).toBe(500_000)

      // 邻近非法模型回退到保守窗口 128k
      expect(inferCodexAlignedGPT5ContextWindow('gpt-6.1-sol-terra')).toBeUndefined()
      expect(inferBudgetContextWindow('gpt-6.1-sol-terra')).toBe(128_000)
    })
  })

  describe('Reasoning Profile', () => {
    it('gpt-6.1-sol 在 openai-responses 协议下沿用 Sol 基线', () => {
      const profile = resolveReasoningProfile({
        modelId: 'gpt-6.1-sol',
        transport: 'openai-responses',
      })
      expect(profile).toBeDefined()
      expect(profile?.id).toBe('openai-reasoning-sol-luna')
      expect(profile?.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
      expect(profile?.defaultLevel).toBe('medium')

      // 非法模型不匹配 profile
      expect(resolveReasoningProfile({
        modelId: 'gpt-6.1-sol-terra',
        transport: 'openai-responses',
      })).toBeUndefined()
    })
  })
})

describe('GPT-6.1 Terra 模型识别与能力基线 (精确匹配)', () => {
  describe('model-family', () => {
    it('isGpt61TerraModel 仅精确识别 gpt-6.1-terra', () => {
      expect(isGpt61TerraModel('gpt-6.1-terra')).toBe(true)
      expect(isGpt61TerraModel('GPT-6.1-TERRA')).toBe(true)
      expect(isGpt61TerraModel(' gpt-6.1-terra ')).toBe(true)
      expect(isGpt61TerraModel('gpt-6.1-terra[1m]')).toBe(true)

      // 邻近非法 ID 及未授权泛化必须被严格拒绝
      expect(isGpt61TerraModel('gpt-6-terra')).toBe(false)
      expect(isGpt61TerraModel('gpt-6.1-terra-sol')).toBe(false)
      expect(isGpt61TerraModel('gpt-6.1-sol-terra')).toBe(false)
      expect(isGpt61TerraModel('gpt-6.1-terra-preview')).toBe(false)
      expect(isGpt61TerraModel('gpt-6.2-terra')).toBe(false)
      expect(isGpt61TerraModel('gpt-6.1')).toBe(false)
      expect(isGpt61TerraModel('gpt-6.1-sol')).toBe(false)
      expect(isGpt61TerraModel(undefined)).toBe(false)
    })

    it('Sol 识别函数不误匹配 gpt-6.1-terra', () => {
      expect(isGpt61SolModel('gpt-6.1-terra')).toBe(false)
      expect(isGpt6SolFamily('gpt-6.1-terra')).toBe(false)
    })
  })

  describe('Fast Mode 白名单防扩散', () => {
    it('gpt-6.1-terra 不盲目纳入 Fast Mode 白名单', () => {
      expect(isCodexFastModeSupportedModel('gpt-6.1-terra')).toBe(false)
      expect(isCodexFastModeSupportedModel('gpt-6.1-terra-preview')).toBe(false)
    })
  })

  describe('上下文窗口基线', () => {
    it('gpt-6.1-terra 保守回退为 SDK Terra 272k 基线，且实测/目录值优先', () => {
      expect(inferCodexAlignedGPT5ContextWindow('gpt-6.1-terra')).toBe(272_000)
      expect(inferBudgetContextWindow('gpt-6.1-terra')).toBe(272_000)

      // 运行时实测值优先级最高
      expect(inferBudgetContextWindow('gpt-6.1-terra', 372_000)).toBe(372_000)

      // 邻近非法模型回退到保守窗口 128k
      expect(inferCodexAlignedGPT5ContextWindow('gpt-6.1-terra-preview')).toBeUndefined()
      expect(inferBudgetContextWindow('gpt-6.1-terra-preview')).toBe(128_000)
    })
  })

  describe('Reasoning Profile', () => {
    it('gpt-6.1-terra 在 openai-responses 协议下沿用已有 Terra (openai-reasoning-max) 基线且默认 high', () => {
      const profile = resolveReasoningProfile({
        modelId: 'gpt-6.1-terra',
        transport: 'openai-responses',
      })
      expect(profile).toBeDefined()
      expect(profile?.id).toBe('openai-reasoning-max')
      expect(profile?.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
      expect(profile?.defaultLevel).toBe('high')

      // 非法邻近模型与非 OpenAI 协议不匹配
      expect(resolveReasoningProfile({
        modelId: 'gpt-6.1-terra-preview',
        transport: 'openai-responses',
      })).toBeUndefined()
      expect(resolveReasoningProfile({
        modelId: 'gpt-6.1-terra',
        transport: 'anthropic-messages',
      })).toBeUndefined()
    })
  })
})
