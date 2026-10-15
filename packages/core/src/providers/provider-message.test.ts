import { describe, expect, test } from 'bun:test'
import { AnthropicAdapter } from './anthropic-adapter.ts'
import { GoogleAdapter } from './google-adapter.ts'
import { OpenAIAdapter } from './openai-adapter.ts'
import { OpenAIResponsesAdapter } from './openai-responses-adapter.ts'
import type { ProviderAdapter, ProviderMessage, StreamRequestInput } from './types.ts'

const history: ProviderMessage[] = [
  { role: 'system', content: '历史系统消息' },
  {
    role: 'user', content: '历史图片',
    attachments: [{ id: 'image', filename: 'image.png', mediaType: 'image/png', localPath: 'session/image.png', size: 1 }],
  },
  { role: 'assistant', content: '历史回复', reasoning: '历史推理' },
]

function createInput(messages: ProviderMessage[]): StreamRequestInput {
  return {
    baseUrl: 'https://example.com/v1', apiKey: 'test-key', modelId: 'test-model',
    history: messages, userMessage: '当前消息',
    readImageAttachments: (attachments) => attachments?.map((attachment) => ({ mediaType: attachment.mediaType, data: 'aW1hZ2U=' })) ?? [],
  }
}

const adapters: ProviderAdapter[] = [
  new AnthropicAdapter(), new GoogleAdapter(), new OpenAIAdapter(), new OpenAIResponsesAdapter(),
]

describe('中性 ProviderMessage 历史契约', () => {
  for (const adapter of adapters) {
    test(`Given 无产品 ID 和时间的历史消息 When ${adapter.providerType} 构建请求 Then 保留正文与图片且过滤历史系统消息`, () => {
      const request = adapter.buildStreamRequest(createInput(history))
      const body = JSON.parse(request.body) as Record<string, unknown>
      const serialized = JSON.stringify(body)
      expect(serialized).toContain('历史图片')
      expect(serialized).toContain('历史回复')
      expect(serialized).toContain('当前消息')
      expect(serialized).toContain('aW1hZ2U=')
      expect(serialized).not.toContain('历史系统消息')
      expect(serialized).not.toContain('localPath')
      expect(serialized).not.toContain('createdAt')
    })

    test(`Given 空历史 When ${adapter.providerType} 构建请求 Then 当前输入仍正常编码`, () => {
      const request = adapter.buildStreamRequest(createInput([]))
      expect(request.body).toContain('当前消息')
      expect(request.body).not.toContain('历史回复')
    })
  }

  test('Given assistant 推理 When OpenAI 与 Google 构建历史 Then 保留协议要求的推理内容', () => {
    for (const adapter of [new OpenAIAdapter(), new GoogleAdapter()]) {
      expect(adapter.buildStreamRequest(createInput(history)).body).toContain('历史推理')
    }
  })
})
