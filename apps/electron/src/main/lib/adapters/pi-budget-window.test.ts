import { describe, expect, it } from 'bun:test'
import { inferBudgetContextWindow } from '@gamma/shared'
import { buildModel } from './pi-model-registry'
import type { PiAgentQueryOptions } from './pi-agent-adapter'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
interface ProbeModel { id: string; contextWindow: number }
interface ProbeProvider { models: ProbeModel[] }

describe('Given 引用预算的实际模型注册链路', () => {
  it('When catalog 未知模型注册后传入预算函数 Then UI初始与运行时均为128k', async () => {
    let registered: ProbeModel | undefined
    const sdk = { ModelRuntime: { create: async () => ({
      registerProvider: (_name: string, provider: ProbeProvider) => { registered = provider.models[0] },
      getModel: () => registered,
    }) } } as unknown as PiSdk
    const modelId = 'gamma-test-unknown-budget-model'
    const result = await buildModel(sdk, {
      provider: 'custom', model: modelId, sessionId: 'budget-test-session',
      apiKey: 'fixture-not-a-secret', baseUrl: 'http://127.0.0.1:9',
    } as PiAgentQueryOptions)
    expect(result.model.contextWindow).toBe(128_000)
    expect(inferBudgetContextWindow(modelId, result.model.contextWindow)).toBe(inferBudgetContextWindow(modelId))
  })

  it('When catalog提供合法较小窗口 Then 不被乐观的200k默认值覆盖', () => {
    expect(inferBudgetContextWindow('catalog-only-fixture', 32_768)).toBe(32_768)
  })

  it('When窗口不是有限安全正整数 Then回退到共享保守值', () => {
    for (const invalid of [NaN, Infinity, -Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(inferBudgetContextWindow('unknown-fixture', invalid)).toBe(128_000)
    }
  })
})
