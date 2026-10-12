import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials } from '@gamma/shared'
import { writeJsonFileAtomic } from './safe-file'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
const originalHome = process.env.HOME
const originalGammaDev = process.env.GAMMA_DEV

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
  shell: {
    openExternal: async () => undefined,
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[], version = 2): void {
  const configDir = join(tempHome, '.gamma')
  mkdirSync(configDir, { recursive: true })
  writeJsonFileAtomic(
    join(configDir, 'channels.json'),
    { version, channels },
  )
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'gamma-channel-runtime-key-'))
  process.env.HOME = tempHome
  process.env.GAMMA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.gamma'), { recursive: true, force: true })
})

afterAll(() => {
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
})
