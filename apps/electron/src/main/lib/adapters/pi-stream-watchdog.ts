import type { StreamFn } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'

export const PI_MODEL_IDLE_TIMEOUT_MS = 120_000
export const PI_MODEL_RETRY_SETTINGS = {
  enabled: true,
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxAgentDelayMs: 5_000,
  provider: { maxRetries: 0 },
}

/** 模型请求的无进展保护；不覆盖工具执行阶段。 */
export function withPiStreamWatchdog(stream: StreamFn, idleTimeoutMs = PI_MODEL_IDLE_TIMEOUT_MS): StreamFn {
  return async (model, context, options) => {
    // Pi 只发布 ESM import 入口；Electron 的 CJS bundle 必须保留动态导入。
    const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai')
    const output = createAssistantMessageEventStream()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let partial: AssistantMessage | undefined

    const cleanup = (): void => {
      clearTimeout(timer)
      options?.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (event: Extract<AssistantMessageEvent, { type: 'done' | 'error' }>): void => {
      if (settled) return
      settled = true
      cleanup()
      output.push(event)
      output.end()
    }
    const fail = (reason: 'error' | 'aborted', message: string): void => {
      if (settled) return
      const error: AssistantMessage = {
        ...(partial ? structuredClone(partial) : {
          role: 'assistant', api: model.api, provider: model.provider, model: model.id,
          content: [], timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        }),
        stopReason: reason,
        errorMessage: message,
      }
      // 先结算消费者，再中止底层请求；即使上游忽略 signal 也不会继续挂住 Agent。
      finish({ type: 'error', reason, error })
      controller.abort()
    }
    const onAbort = (): void => fail('aborted', '用户已取消模型请求')
    const arm = (): void => {
      clearTimeout(timer)
      if (idleTimeoutMs > 0) {
        timer = setTimeout(() => fail('error', `模型请求连续 ${Math.round(idleTimeoutMs / 1_000)} 秒没有新输出（timeout），已取消本次请求。`), idleTimeoutMs)
      }
    }

    if (options?.signal?.aborted) {
      onAbort()
      return output
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    arm()
    void (async () => {
      try {
        // 只让 Pi Agent 层重试，避免 provider 内层重试再次放大无反馈等待时间。
        const source = await stream(model, context, { ...options, signal: controller.signal, maxRetries: 0 })
        if (settled) return
        for await (const event of source) {
          if (settled) break
          if (event.type === 'done' || event.type === 'error') {
            finish(event)
            return
          }
          partial = event.partial
          output.push(event)
          arm()
        }
        if (!settled) fail('error', '模型响应流在终态前结束（stream_read_error），请重试。')
      } catch (error) {
        fail('error', error instanceof Error ? error.message : '模型请求失败')
      }
    })()
    return output
  }
}
