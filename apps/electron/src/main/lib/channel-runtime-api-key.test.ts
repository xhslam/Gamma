import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials } from '@gamma/shared'
import { writeJsonFileAtomic } from './safe-file'
import { setConfigHomeForTest } from './config-paths'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
let originalHome: string | undefined
let originalGammaDev: string | undefined
let previousConfigHome: string | undefined

function writeChannels(channels: unknown[], version = 2): void {
  const configDir = join(tempHome, '.gamma')
  mkdirSync(configDir, { recursive: true })
  writeJsonFileAtomic(
    join(configDir, 'channels.json'),
    { version, channels },
  )
}

beforeAll(async () => {
  originalHome = process.env.HOME
  originalGammaDev = process.env.GAMMA_DEV
  tempHome = mkdtempSync(join(os.tmpdir(), 'gamma-channel-runtime-key-'))
  process.env.HOME = tempHome
  previousConfigHome = setConfigHomeForTest(tempHome)
  process.env.GAMMA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.gamma'), { recursive: true, force: true })
})

afterAll(() => {
  setConfigHomeForTest(previousConfigHome)
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalGammaDev === undefined) {
    delete process.env.GAMMA_DEV
  } else {
    process.env.GAMMA_DEV = originalGammaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('渠道运行时认证解析', () => {
  test('Given ChatGPT OAuth 渠道 When 解析运行时 key Then 返回 access token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: serializeCodexCredentials({
          access: 'oauth-access-token',
          refresh: 'oauth-refresh-token',
          expires: Date.now() + 3_600_000,
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('codex-channel'))
      .resolves.toBe('oauth-access-token')
  })

  test('Given 普通渠道 When 解析运行时 key Then 返回解密后的 API Key', async () => {
    writeChannels([
      {
        id: 'api-key-channel',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'plain-api-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('api-key-channel'))
      .resolves.toBe('plain-api-key')
  })
})

interface MigrationChannel {
  id: string
  name: string
  provider: string
  apiKey: string
}

interface MigrationConfig {
  version: number
  channels: MigrationChannel[]
}

function legacyChannel(id: string, provider: string, name = '用户自定义渠道名') {
  return {
    id, name, provider,
    baseUrl: 'https://example.com/v1',
    apiKey: 'preserved-api-key',
    models: [], enabled: true, createdAt: 1, updatedAt: 2,
  }
}

describe('退役渠道迁移', () => {
  for (const version of [1, 6, 7, 42]) {
    test(`Given v${version} 配置含退役套餐和有效 API When 读取渠道 Then 清理旧套餐并保留 API 配置且迁移幂等`, () => {
      writeChannels([
        legacyChannel('legacy-doubao', 'doubao'),
        legacyChannel('legacy-ark', 'ark-coding-plan'),
        legacyChannel('legacy-opencode', 'opencode-go-openai'),
        legacyChannel('retained-api', 'doubao-api'),
      ], version)

      expect(channelManager.getChannelById('retained-api')).toMatchObject({
        provider: 'doubao-api', name: '用户自定义渠道名', apiKey: 'preserved-api-key',
      })
      const file = join(tempHome, '.gamma', 'channels.json')
      const firstWrite = readFileSync(file, 'utf-8')
      const config = JSON.parse(firstWrite) as MigrationConfig
      expect(config.version).toBe(Math.max(version, 7))
      expect(config.channels.map((channel) => channel.provider)).toEqual(['doubao-api'])

      expect(channelManager.getChannelById('legacy-doubao')).toBeUndefined()
      expect(channelManager.getChannelById('legacy-ark')).toBeUndefined()
      expect(readFileSync(file, 'utf-8')).toBe(firstWrite)
    })
  }

  test('Given 旧豆包 API 默认名称 When 迁移旧配置 Then 只更新展示名而保留 API 类型和密钥', () => {
    writeChannels([legacyChannel('api', 'doubao-api', '豆包 API')], 2)
    expect(channelManager.getChannelById('api')).toMatchObject({
      provider: 'doubao-api', name: '火山引擎 API', apiKey: 'preserved-api-key',
    })
  })

  test('Given 存量 Codex 渠道缺少 GPT-6.1 Sol When 读取渠道 Then 自动补充 gpt-6.1-sol 候选', () => {
    writeChannels([
      {
        id: 'codex-channel-existing',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: 'dummy-key',
        models: [
          { id: 'gpt-6-sol', name: 'GPT-6 Sol', enabled: true },
        ],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ], 7)

    const channel = channelManager.getChannelById('codex-channel-existing')
    expect(channel).toBeDefined()
    expect(channel?.models.some((model) => model.id === 'gpt-6.1-sol' && model.name === 'GPT-6.1 Sol' && model.enabled)).toBe(true)
  })

  test('Given 存量 Codex 渠道缺少 GPT-6.1 Terra When 读取渠道 Then 自动补充 gpt-6.1-terra 候选且不重复添加', () => {
    writeChannels([
      {
        id: 'codex-channel-existing-terra',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: 'dummy-key',
        models: [
          { id: 'gpt-6-sol', name: 'GPT-6 Sol', enabled: true },
        ],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ], 7)

    const channel = channelManager.getChannelById('codex-channel-existing-terra')
    expect(channel).toBeDefined()
    expect(channel?.models.some((model) => model.id === 'gpt-6.1-terra' && model.name === 'GPT-6.1 Terra' && model.enabled)).toBe(true)

    // 重复读取不会重复添加
    const channelAgain = channelManager.getChannelById('codex-channel-existing-terra')
    const terraCount = channelAgain?.models.filter((model) => model.id === 'gpt-6.1-terra').length
    expect(terraCount).toBe(1)
  })
})
