import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sdk from '@earendil-works/pi-coding-agent'
import type { Api, CredentialStore, Model } from '@earendil-works/pi-ai'
import { CodexModelStore } from './pi-codex-model-store'
import { buildCodexModel, refreshCodexModels } from './pi-model-registry'

const credentials = { access: 'test-access', refresh: 'test-refresh', expires: Date.now() + 3_600_000 }
const credentialStore: CredentialStore = {
  async read(providerId) { return providerId === 'openai-codex' ? { type: 'oauth', ...credentials } : undefined },
  async list() { return [{ providerId: 'openai-codex', type: 'oauth' }] },
  async modify(_providerId, operation) { return operation({ type: 'oauth', ...credentials }) },
  async delete() {},
}
const latestModel: Model<Api> = {
  id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'openai-codex',
  api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api',
  reasoning: true, input: ['text', 'image'], contextWindow: 272_000, maxTokens: 128_000,
  cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  thinkingLevelMap: { off: null, minimal: 'low', xhigh: 'xhigh', max: 'max' },
}
const directories: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), 'proma-codex-models-'))
  directories.push(directory)
  return new CodexModelStore(join(directory, 'models.json'))
}

async function createRuntime(store: CodexModelStore, handler: (request: Request) => Response) {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return sdk.ModelRuntime.create({
    credentials: credentialStore, modelsPath: null, modelsStore: store,
    allowModelNetwork: false, catalogBaseUrl: server.url.toString(),
  })
}

function catalogResponse() {
  return Response.json({ models: [latestModel] }, {
    headers: { 'last-modified': new Date('2099-01-01').toUTCString(), etag: '"new-model"' },
  })
}

describe('ChatGPT 订阅模型在线检测', () => {
  test('Given 在线目录含新模型 When 检测 Then 获取新模型且只请求 Codex 目录', async () => {
    const store = createStore()
    const paths: string[] = []
    const authorizationHeaders: boolean[] = []
    const runtime = await createRuntime(store, (request) => {
      paths.push(new URL(request.url).pathname)
      authorizationHeaders.push(request.headers.has('authorization'))
      return catalogResponse()
    })
    const models = await refreshCodexModels(runtime)
    expect(models.find((model) => model.id === latestModel.id)).toEqual(latestModel)
    expect(paths).toEqual(['/api/models/providers/openai-codex'])
    expect(authorizationHeaders).toEqual([false])
    expect((await store.read('openai-codex'))?.models).toEqual([latestModel])
    expect(models.some((model) => model.id === 'gpt-6-sol')).toBe(true)
    expect(models.some((model) => model.id === 'gpt-5.3-codex-spark' || model.id.startsWith('gpt-5.4') || model.id === 'gpt-5.5')).toBe(false)
  })

  test('Given 已缓存新模型且目录不可用 When 检测 Then 保留缓存新模型', async () => {
    const store = createStore()
    await store.write('openai-codex', { models: [latestModel], lastModified: Date.parse('2099-01-01') })
    const runtime = await createRuntime(store, () => new Response('unavailable', { status: 404 }))
    expect((await refreshCodexModels(runtime)).some((model) => model.id === latestModel.id)).toBe(true)
  })

  test('Given 在线响应损坏且无缓存 When 检测 Then 回退内置及补充模型', async () => {
    const runtime = await createRuntime(createStore(), () => new Response('invalid json'))
    const models = await refreshCodexModels(runtime)
    expect(models.some((model) => model.id === 'gpt-6-sol')).toBe(true)
    expect(models.some((model) => model.id === latestModel.id)).toBe(false)
  })

  test('Given Pi 没有可用模型 When 检测 Then 不凭补充目录生成可用模型', async () => {
    expect(await refreshCodexModels({
      async refresh() { return { aborted: false, errors: new Map() } },
      async getAvailable() { return [] },
    })).toEqual([])
  })

  test('Given 刷新失败 When 检测 Then 仍返回缓存模型', async () => {
    expect((await refreshCodexModels({
      async refresh(options) {
        expect(options).toMatchObject({ providers: ['openai-codex'], allowNetwork: true, force: true })
        expect(options?.signal).toBeInstanceOf(AbortSignal)
        return { aborted: true, errors: new Map() }
      },
      async getAvailable() { return [latestModel] },
    })).some((model) => model.id === latestModel.id)).toBe(true)
  })

  test('Given 已检测并缓存新模型 When 创建会话模型 Then 离线恢复相同模型能力', async () => {
    const store = createStore()
    const runtime = await createRuntime(store, () => catalogResponse())
    await refreshCodexModels(runtime)
    const scopedSdk = {
      ...sdk,
      ModelRuntime: {
        ...sdk.ModelRuntime,
        create: async (options: Parameters<typeof sdk.ModelRuntime.create>[0]) => {
          expect(options?.modelsPath).toBeNull()
          expect(options?.allowModelNetwork).toBe(false)
          return sdk.ModelRuntime.create({ ...options, modelsStore: store })
        },
      } as typeof sdk.ModelRuntime,
    }
    const { model } = await buildCodexModel(scopedSdk, { model: latestModel.id, codexOAuthCredentials: credentials })
    expect(model).toEqual(latestModel)
    await expect(buildCodexModel(scopedSdk, { model: 'nonexistent-model', codexOAuthCredentials: credentials })).rejects.toThrow('未找到指定')
  })

  test('Given 其他 provider When 写入目录 Then 不污染 Codex 缓存', async () => {
    const store = createStore()
    await store.write('openai-codex', { models: [latestModel] })
    await store.write('anthropic', { models: [] })
    await store.delete('anthropic')
    expect(await store.read('anthropic')).toBeUndefined()
    expect((await store.read('openai-codex'))?.models).toEqual([latestModel])
    await store.delete('openai-codex')
    expect((await store.read('openai-codex'))?.models).toEqual([])
  })
})
