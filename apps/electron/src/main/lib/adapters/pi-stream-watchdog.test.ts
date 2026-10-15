import { describe, expect, test } from 'bun:test'
import { Agent, type StreamFn } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { getModel, retryAssistantCall, type AssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai/compat'
import { Type } from 'typebox'
import { PI_MODEL_RETRY_SETTINGS, withPiStreamWatchdog } from './pi-stream-watchdog'
import { mapPiNativeRetryEvent } from './pi-retry-control'

const model = getModel('openai', 'gpt-4o-mini')
const context = { messages: [] } as unknown as TranscriptContext

function message(stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return {
    role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: [], timestamp: Date.now(), stopReason,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
}

function completed(value: AssistantMessage) {
  const stream = createAssistantMessageEventStream()
  stream.push({ type: 'start', partial: value })
  stream.push({ type: 'done', reason: 'stop', message: value })
  stream.end()
  return stream
}

async function withinDeadline(result: Promise<AssistantMessage>): Promise<AssistantMessage | 'stalled'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      result,
      new Promise<'stalled'>((resolve) => { timer = setTimeout(() => resolve('stalled'), 100) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('模型无进展保护与重试可见性', () => {
  test('Given 上游永不返回事件 When 超过无进展期限 Then 取消请求并返回可见失败', async () => {
    let signal: AbortSignal | undefined
    const provider: StreamFn = (_model, _context, options) => {
      signal = options?.signal
      return createAssistantMessageEventStream()
    }
    const response = await withPiStreamWatchdog(provider, 10)(model, context)
    const result = await withinDeadline(response.result())
    expect(result).not.toBe('stalled')
    if (result === 'stalled') return
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('timeout')
    expect(signal?.aborted).toBe(true)
  })

  test('Given 第一次网络重试 When Pi 安排退避 Then 立即向界面展示原因和等待时间', () => {
    expect(mapPiNativeRetryEvent({
      type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 1_000, errorMessage: 'fetch failed',
    }, { runStartedAt: 100 }, 200)).toMatchObject([{
      status: 'starting', attempt: 1, delaySeconds: 1, reason: 'fetch failed', runStartedAt: 100,
    }])
  })

  test('Given 自动恢复策略 Then 最多重试两次且不叠加 provider 内部重试', () => {
    expect(PI_MODEL_RETRY_SETTINGS.maxRetries).toBe(2)
    expect(PI_MODEL_RETRY_SETTINGS.provider.maxRetries).toBe(0)
  })

  test('Given 创建流的 Promise 自身挂起 When 超时 Then 无需等待 provider 返回也能结束', async () => {
    const response = await withPiStreamWatchdog(() => new Promise(() => {}), 10)(model, context)
    const result = await withinDeadline(response.result())
    expect(result).not.toBe('stalled')
    if (result !== 'stalled') expect(result.stopReason).toBe('error')
  })

  test('Given 持续思考输出超过一个超时周期 When 每次仍有进展 Then 正常完成且不取消请求', async () => {
    let signal: AbortSignal | undefined
    const provider: StreamFn = (_model, _context, options) => {
      signal = options?.signal
      const stream = createAssistantMessageEventStream()
      const partial = message()
      stream.push({ type: 'start', partial })
      void (async () => {
        for (let i = 0; i < 6; i += 1) {
          await Bun.sleep(10)
          stream.push({ type: 'thinking_delta', contentIndex: 0, delta: '思考', partial })
        }
        stream.push({ type: 'done', reason: 'stop', message: partial })
        stream.end()
      })()
      return stream
    }
    const result = await (await withPiStreamWatchdog(provider, 40)(model, context)).result()
    expect(result.stopReason).toBe('stop')
    await Bun.sleep(50)
    expect(signal?.aborted).toBe(false)
  })

  test('Given 用户取消正在挂起的请求 When Pi native retry 接手 Then 立即结束且不重试', async () => {
    const controller = new AbortController()
    let attempts = 0
    const stream = withPiStreamWatchdog(() => {
      attempts += 1
      return createAssistantMessageEventStream()
    }, 0)
    const response = await stream(model, context, { signal: controller.signal })
    controller.abort()
    const result = await retryAssistantCall(() => response.result(), PI_MODEL_RETRY_SETTINGS, controller.signal)
    expect(result.stopReason).toBe('aborted')
    expect(attempts).toBe(1)
  })

  test('Given 调用前已经取消 When 创建模型流 Then 不调用 provider', async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    const response = await withPiStreamWatchdog(() => {
      called = true
      return completed(message())
    })(model, context, { signal: controller.signal })
    expect((await response.result()).stopReason).toBe('aborted')
    expect(called).toBe(false)
  })

  test('Given 显式禁用空闲超时 When 超过默认测试期限仍未返回 Then 保留用户设置直到主动取消', async () => {
    const controller = new AbortController()
    const response = await withPiStreamWatchdog(() => createAssistantMessageEventStream(), 0)(model, context, { signal: controller.signal })
    expect(await withinDeadline(response.result())).toBe('stalled')
    controller.abort()
    expect((await response.result()).stopReason).toBe('aborted')
  })

  test('Given 所有模型请求均停滞 When 进入 Pi native 重试 Then 仅尝试三次后给出失败', async () => {
    let attempts = 0
    const stream = withPiStreamWatchdog((_model, _context, options) => {
      attempts += 1
      expect(options?.maxRetries).toBe(0)
      return createAssistantMessageEventStream()
    }, 5)
    const result = await retryAssistantCall(async () => (await stream(model, context)).result(), {
      ...PI_MODEL_RETRY_SETTINGS, baseDelayMs: 0,
    }, undefined)
    expect(attempts).toBe(3)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('timeout')
  })

  test('Given 超时后 provider 迟到成功 When 读取结果和事件 Then 不能覆盖失败或执行半截工具', async () => {
    const source = createAssistantMessageEventStream()
    const partial = message('toolUse')
    partial.content = [{ type: 'toolCall', id: 'late', name: 'mutate', arguments: {} }]
    source.push({ type: 'start', partial })
    const response = await withPiStreamWatchdog(() => source, 5)(model, context)
    expect((await response.result()).stopReason).toBe('error')
    source.push({ type: 'done', reason: 'toolUse', message: partial })
    source.end()
    const events = []
    for await (const event of response) events.push(event.type)
    expect(events).toEqual(['start', 'error'])
    expect((await response.result()).stopReason).toBe('error')
  })

  test('Given 上游无终态关闭或直接抛错 When 消费流 Then 返回失败而非无限等待 result', async () => {
    const closed = createAssistantMessageEventStream()
    closed.end()
    const ended = await withPiStreamWatchdog(() => closed, 10)(model, context)
    expect((await ended.result()).errorMessage).toContain('stream_read_error')
    const failed = await withPiStreamWatchdog(() => { throw new Error('fetch failed') }, 10)(model, context)
    expect((await failed.result()).errorMessage).toBe('fetch failed')
  })

  test('Given 真实 Agent 工具执行时间超过模型超时 When 工具结束后继续请求 Then 正常完成且只执行一次', async () => {
    let calls = 0
    let requests = 0
    const agent = new Agent({
      initialState: { model, tools: [{
        name: 'mutate', label: '测试工具', description: '验证长工具不被模型超时中止', parameters: Type.Object({}),
        execute: async () => {
          calls += 1
          await Bun.sleep(30)
          return { content: [{ type: 'text', text: '完成' }], details: {} }
        },
      }] },
      streamFn: withPiStreamWatchdog(() => {
        const final = message(requests++ === 0 ? 'toolUse' : 'stop')
        if (final.stopReason === 'toolUse') final.content = [{ type: 'toolCall', id: 'only-once', name: 'mutate', arguments: {} }]
        const source = createAssistantMessageEventStream()
        source.push({ type: 'start', partial: final })
        source.push({ type: 'done', reason: final.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: final })
        source.end()
        return source
      }, 10),
    })
    await agent.prompt('执行工具后结束')
    expect(calls).toBe(1)
    expect(requests).toBe(2)
    expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
  })

  test('Given 真实 Agent 收到半截工具调用后断流 When 无进展超时 Then 不执行该工具', async () => {
    let calls = 0
    const agent = new Agent({
      initialState: { model, tools: [{
        name: 'mutate', label: '测试工具', description: '不执行未完成调用', parameters: Type.Object({}),
        execute: async () => { calls += 1; return { content: [], details: {} } },
      }] },
      streamFn: withPiStreamWatchdog(() => {
        const source = createAssistantMessageEventStream()
        const partial = message('toolUse')
        partial.content = [{ type: 'toolCall', id: 'partial', name: 'mutate', arguments: {} }]
        source.push({ type: 'start', partial })
        return source
      }, 5),
    })
    await agent.prompt('不执行断流中的工具')
    expect(calls).toBe(0)
    expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'error' })
  })

  test('Given 首次重试恢复成功或预算耗尽 When 生命周期结束 Then 界面清除等待或显示失败', () => {
    expect(mapPiNativeRetryEvent({ type: 'auto_retry_end', attempt: 1, success: true }, { runStartedAt: 100 }))
      .toMatchObject([{ status: 'cleared', attempt: 1 }])
    expect(mapPiNativeRetryEvent({ type: 'auto_retry_end', attempt: 2, success: false, finalError: 'fetch failed' }, { runStartedAt: 100 }))
      .toMatchObject([{ status: 'failed', attempt: 2, attemptData: { errorMessage: 'fetch failed' } }])
  })
})
