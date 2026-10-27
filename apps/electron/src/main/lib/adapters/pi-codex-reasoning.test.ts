import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Api, Model, ModelsStoreEntry } from '@earendil-works/pi-ai'
import { CodexModelStore } from './pi-codex-model-store'
import { getCodexCatalogModels, resolvePiReasoningCapability } from './pi-model-registry'
import { resolvePiThinkingLevel } from '../agent-thinking-level'

const onlineModel: Model<Api> = {
  id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'openai-codex',
  api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api',
  reasoning: true, input: ['text', 'image'], contextWindow: 272_000, maxTokens: 128_000,
  cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  thinkingLevelMap: { off: null, minimal: null, xhigh: 'xhigh', max: 'max' },
}
let readStore: ReturnType<typeof spyOn<CodexModelStore, 'read'>>
beforeEach(() => { readStore = spyOn(CodexModelStore.prototype, 'read') })
afterEach(() => readStore.mockRestore())

function cache(models: Model<Api>[] | undefined): void {
  readStore.mockImplementation(async (providerId): Promise<ModelsStoreEntry | undefined> => (
    providerId === 'openai-codex' && models ? { models } : undefined
  ))
}

describe('ChatGPT 订阅推理滑杆能力', () => {
  test('Given 在线模型仅存在受管缓存 When 查询滑杆能力 Then 显示实际支持的档位', async () => {
    cache([onlineModel])
    expect((await getCodexCatalogModels()).find((model) => model.id === onlineModel.id)).toEqual(onlineModel)
    expect(await resolvePiReasoningCapability('openai-codex', onlineModel.id)).toEqual({
      source: 'pi-catalog', levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'high',
    })
  })

  test('Given 选择最高档位 When 下一轮解析推理强度 Then 保留会话档位而非全局开关', async () => {
    cache([onlineModel])
    const capability = await resolvePiReasoningCapability('openai-codex', onlineModel.id)
    expect(capability).toBeDefined()
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'disabled' } }, { reasoningLevel: 'max' },
      'openai-codex', onlineModel.id, capability,
    )).toBe('max')
  })

  test('Given 目录声明 minimal 有效 When 查询能力 Then 不擅自移除最小档位', async () => {
    cache([{ ...onlineModel, thinkingLevelMap: { off: null, xhigh: 'xhigh' } }])
    expect((await resolvePiReasoningCapability('openai-codex', onlineModel.id))?.levels).toEqual([
      'minimal', 'low', 'medium', 'high', 'xhigh',
    ])
  })

  test('Given 同 ID 内置模型和更新缓存 When 查询目录 Then 缓存优先且保留补充模型', async () => {
    cache(undefined)
    const builtIn = (await getCodexCatalogModels()).find((model) => model.id === 'gpt-6-sol')!
    expect(builtIn).toBeDefined()
    const updated = { ...builtIn, headers: { 'x-catalog-revision': 'latest' } }
    cache([updated])
    const models = await getCodexCatalogModels()
    expect(models.find((model) => model.id === updated.id)?.headers).toEqual(updated.headers)
    expect(models.some((model) => model.id === 'gpt-6-sol')).toBe(true)
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length)
  })

  test('Given 无缓存或模型未声明推理 When 查询能力 Then 不制造可用档位', async () => {
    cache(undefined)
    expect(await resolvePiReasoningCapability('openai-codex', 'nonexistent-model')).toBeUndefined()
    cache([{ ...onlineModel, reasoning: false }])
    expect(await resolvePiReasoningCapability('openai-codex', onlineModel.id)).toBeUndefined()
  })

  test('Given 其他渠道 When 查询模型 Then 不读取订阅缓存', async () => {
    cache([onlineModel])
    expect(await resolvePiReasoningCapability('google', onlineModel.id)).toBeUndefined()
    expect(readStore).not.toHaveBeenCalled()
  })
})
