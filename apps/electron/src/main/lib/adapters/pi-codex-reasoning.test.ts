import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Api, Model, ModelsStoreEntry } from '@earendil-works/pi-ai'
import { getModels } from '@earendil-works/pi-ai/compat'
import { CodexModelStore } from './pi-codex-model-store'
import { getCodexCatalogModels, resolvePiReasoningCapability } from './pi-model-registry'
import { resolvePiThinkingLevel } from '../agent-thinking-level'

const onlineModel: Model<Api> = {
  id: 'gamma-fixture-online-only', name: '本地在线目录夹具', provider: 'openai-codex',
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

  test('Given GPT-6.1 Sol When 查询 Codex 目录与推理能力 Then 正确返回且沿用 Sol 基线', async () => {
    cache(undefined)
    const sol61 = (await getCodexCatalogModels()).find((model) => model.id === 'gpt-6.1-sol')
    expect(sol61).toBeDefined()
    expect(sol61?.id).toBe('gpt-6.1-sol')
    expect(sol61?.name).toBe('GPT-6.1 Sol')
    expect(sol61?.contextWindow).toBe(500_000)
    // 不用旧 Sol 补丁覆盖 SDK 已提供的上下文、协议能力和费用元数据。
    expect(sol61).toEqual(getModels('openai-codex').find((model) => model.id === 'gpt-6.1-sol'))

    const capability = await resolvePiReasoningCapability('openai-codex', 'gpt-6.1-sol')
    expect(capability).toEqual({
      source: 'profile',
      levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultLevel: 'medium',
    })

    // 非法邻近 ID 不生成能力
    expect(await resolvePiReasoningCapability('openai-codex', 'gpt-6.1-sol-terra')).toBeUndefined()
    expect(await resolvePiReasoningCapability('openai-codex', 'gpt-6.1-sol-preview')).toBeUndefined()
  })

  test('Given GPT-6.1 Terra When 查询 Codex 目录与推理能力 Then 正确返回且沿用 Terra 基线', async () => {
    cache(undefined)
    const terra61 = (await getCodexCatalogModels()).find((model) => model.id === 'gpt-6.1-terra')
    expect(terra61).toBeDefined()
    expect(terra61?.id).toBe('gpt-6.1-terra')
    expect(terra61?.name).toBe('GPT-6.1 Terra')
    expect(terra61?.contextWindow).toBe(272_000)
    expect(terra61?.maxTokens).toBe(128_000)

    const capability = await resolvePiReasoningCapability('openai-codex', 'gpt-6.1-terra')
    expect(capability).toEqual({
      source: 'profile',
      levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultLevel: 'high',
    })

    // 非法邻近 ID 不生成能力
    expect(await resolvePiReasoningCapability('openai-codex', 'gpt-6.1-terra-preview')).toBeUndefined()
  })

  test('Given 缓存或 SDK 包含更新的 GPT-6.1 Terra 元数据 When 查询 Codex 目录 Then 优先保留新元数据不被旧回退覆盖', async () => {
    const updatedTerra: Model<Api> = {
      id: 'gpt-6.1-terra',
      name: 'GPT-6.1 Terra (Official Online)',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 3, output: 18, cacheRead: 0.3, cacheWrite: 3 },
      contextWindow: 500_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        xhigh: 'xhigh',
        max: 'max',
      },
      type: 'chat',
    }
    cache([updatedTerra])
    const catalog = await getCodexCatalogModels()
    const terra = catalog.find((model) => model.id === 'gpt-6.1-terra')
    expect(terra).toBeDefined()
    expect(terra?.name).toBe('GPT-6.1 Terra (Official Online)')
    expect(terra?.contextWindow).toBe(500_000)
    expect(terra?.cost.input).toBe(3)
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
