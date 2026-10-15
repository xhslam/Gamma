import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@gamma/shared'
import { PiAgentAdapter } from './pi-agent-adapter'
import type { PiRetryUpdate } from './pi-retry-control'

function successResponse(): Response {
  const frame = (delta: object, finishReason: string | null): string => `data: ${JSON.stringify({
    id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4o-mini',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
  return new Response(`${frame({ role: 'assistant', content: '完成' }, null)}${frame({}, 'stop')}data: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

async function runAgainstLocalProvider(response: () => Response) {
  const root = mkdtempSync(join(tmpdir(), 'gamma-stream-regression-'))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: response })
  const adapter = new PiAgentAdapter()
  const retries: PiRetryUpdate[] = []
  const messages: SDKMessage[] = []
  try {
    for await (const item of adapter.query({
      sessionId: 'stream-regression', prompt: '只回复完成', model: 'gpt-4o-mini',
      provider: 'openai', baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: 'fixture-only',
      cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'),
      permissionMode: 'bypassPermissions', systemPrompt: '只回复完成，不调用工具。',
      httpIdleTimeoutMs: 500, onRetry: (update) => retries.push(update),
    })) messages.push(item)
    return { messages, retries }
  } finally {
    adapter.dispose()
    await server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('真实 Pi 适配器的网络恢复边界（本地确定性模型替身）', () => {
  test('Given provider 首次返回 503 When 原生恢复后成功 Then 首次重试可见且没有内层重试', async () => {
    let requests = 0
    const { messages, retries } = await runAgainstLocalProvider(() => {
      requests += 1
      return requests === 1 ? new Response('service unavailable', { status: 503 }) : successResponse()
    })
    expect(requests).toBe(2)
    expect(retries.map((item) => item.status)).toEqual(['starting', 'cleared'])
    expect(retries[0]).toMatchObject({ attempt: 1, maxAttempts: 2 })
    expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'success' })
  }, 10_000)

  test('Given provider 持续返回 503 When 两次原生重试耗尽 Then 在三次请求后结束并显示失败', async () => {
    let requests = 0
    const { messages, retries } = await runAgainstLocalProvider(() => {
      requests += 1
      return new Response('service unavailable', { status: 503 })
    })
    expect(requests).toBe(3)
    expect(retries.filter((item) => item.status === 'starting')).toHaveLength(2)
    expect(retries.at(-1)).toMatchObject({ status: 'failed', attempt: 2 })
    expect(messages.some((item) => item.type === 'result' && item.subtype !== 'success')).toBe(true)
  }, 10_000)

  test('Given HTTP 流只发送开头后一直停滞 When 无进展超时并耗尽恢复 Then 结束真实适配器而不永久挂起', async () => {
    let requests = 0
    const { messages, retries } = await runAgainstLocalProvider(() => {
      requests += 1
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"id":"stalled","choices":[{"index":0,"delta":{"role":"assistant","content":"开始"},"finish_reason":null}]}\n\n'))
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })
    })
    expect(requests).toBe(3)
    expect(retries.filter((item) => item.status === 'starting')).toHaveLength(2)
    expect(retries.at(-1)).toMatchObject({ status: 'failed', attempt: 2 })
    expect(messages.some((item) => item.type === 'result' && item.subtype !== 'success')).toBe(true)
  }, 10_000)
})
