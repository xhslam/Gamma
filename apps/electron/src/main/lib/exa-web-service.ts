import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createManagedWebFetch } from './web-network'

export interface ExaWebOptions {
  proxyUrl?: string
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

export class ExaWebServiceError extends Error {
  constructor(readonly reason: 'timeout' | 'rate-limit' | 'failed') {
    super(reason === 'timeout' ? '联网服务请求超时。' : reason === 'rate-limit' ? '联网服务达到免费使用限额。' : '联网服务请求失败。')
    this.name = 'ExaWebServiceError'
  }
}

/** 搜索与公开正文读取共用官方 MCP SDK，网络、取消与连接资源始终按请求隔离。 */
export async function callExaWebTool(
  name: 'web_search_exa' | 'web_fetch_exa',
  args: Record<string, unknown>,
  options: ExaWebOptions = {},
): Promise<CallToolResult> {
  const requestedTimeout = options.timeoutMs ?? 30_000
  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) throw new Error('联网请求截止时间必须为正数。')
  const timeoutMs = Math.min(requestedTimeout, 30_000)
  const deadline = new AbortController()
  const signal = AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])])
  const timeout = setTimeout(() => deadline.abort(), timeoutMs)
  const client = new Client({ name: 'proma-web-service', version: '1.0.0' }, { capabilities: {} })
  let transport: StreamableHTTPClientTransport | undefined
  let network: ReturnType<typeof createManagedWebFetch> | undefined

  try {
    signal.throwIfAborted()
    network = options.fetch ? undefined : createManagedWebFetch(options.proxyUrl, { preferProxy: true })
    const baseFetch = options.fetch ?? network!.fetch
    // 同时约束 SDK 的传输信号与任务总截止时间，握手、通知和 SSE 也必须可取消。
    const requestFetch: FetchLike = (url, init) => baseFetch(url, {
      ...init,
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    })
    transport = new StreamableHTTPClientTransport(new URL('https://mcp.exa.ai/mcp'), { fetch: requestFetch })
    await client.connect(transport, { signal, timeout: timeoutMs })
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, CallToolResultSchema, { signal, timeout: timeoutMs }))
    signal.throwIfAborted()
    if (result.isError) throw new ExaWebServiceError('failed')
    return result
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('联网请求已取消。', 'AbortError')
    if (deadline.signal.aborted) throw new ExaWebServiceError('timeout')
    if (error instanceof StreamableHTTPError && error.code === 429) throw new ExaWebServiceError('rate-limit')
    // 底层异常可能含代理凭证，不传播消息或 cause。
    throw new ExaWebServiceError('failed')
  } finally {
    clearTimeout(timeout)
    try { await client.close() } catch { /* 继续释放其余资源 */ }
    try { await transport?.close() } catch { /* 握手失败也释放 transport */ }
    try { await network?.close() } catch { /* 清理错误不覆盖正常结果与取消 */ }
  }
}
