/** 公开网页请求独立于模型代理和进程环境；直连失败时才尝试配置的代理。 */
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici'
import type { Dispatcher } from 'undici'

export type WebRequestRoute = 'direct' | 'proxy'

export interface WebNetworkOptions {
  /** 搜索服务可以优先使用代理；网页默认直连优先。 */
  preferProxy?: boolean
  directTimeoutMs?: number
  proxyTimeoutMs?: number
  onRoute?: (url: string, route: WebRequestRoute) => void
}

export interface ManagedWebFetch {
  fetch: typeof globalThis.fetch
  close: () => Promise<void>
}

const RETRYABLE_STATUS = new Set([403, 408, 451, 502, 503, 504])

/** 仅接受网络地址，不携带 URL 凭据，也不会读取本地文件或浏览器登录态。 */
export function assertWebUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('网页地址必须是完整的 HTTP(S) URL。') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('网页读取仅支持 HTTP(S) 地址。')
  if (url.username || url.password) throw new Error('网页地址不能包含用户名或密码。')
  return url
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

/**
 * 不使用 globalThis.fetch、环境代理或全局 dispatcher，防止 Pi 的 async scope 串入网页请求。
 * 两条路由各自有超时；取消不重试，429 不切换出口绕过服务配额。
 */
export function createManagedWebFetch(proxyUrl?: string, options: WebNetworkOptions = {}): ManagedWebFetch {
  const direct = new Agent({ connect: { timeout: 10_000 } })
  let proxy: Dispatcher | undefined
  let invalidProxy = false
  const normalizedProxy = proxyUrl?.trim()
  const routes: WebRequestRoute[] = normalizedProxy
    ? options.preferProxy ? ['proxy', 'direct'] : ['direct', 'proxy']
    : ['direct']

  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = assertWebUrl(requestUrl(input)).href
    const callerSignal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined)
    callerSignal?.throwIfAborted()
    for (const [index, route] of routes.entries()) {
      const timeoutMs = route === 'direct'
        ? options.directTimeoutMs ?? (normalizedProxy ? 5_000 : 20_000)
        : options.proxyTimeoutMs ?? 20_000
      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
      try {
        if (route === 'proxy' && !proxy) {
          try {
            const protocol = new URL(normalizedProxy!).protocol
            if (protocol !== 'http:' && protocol !== 'https:') throw new Error('不支持的代理协议')
          } catch {
            invalidProxy = true
            throw new Error('代理配置不适用于网页请求')
          }
          proxy = new ProxyAgent(normalizedProxy!)
        }
        const response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
          ...init,
          signal,
          dispatcher: route === 'direct' ? direct : proxy,
        } as Parameters<typeof undiciFetch>[1])
        if (index < routes.length - 1 && RETRYABLE_STATUS.has(response.status)) {
          await response.body?.cancel()
          continue
        }
        options.onRoute?.(url, route)
        return response as unknown as Response
      } catch {
        callerSignal?.throwIfAborted()
        if (index === routes.length - 1) {
          if (invalidProxy) throw new Error('联网工具需要 HTTP(S) 代理地址；Clash Verge 请填写 HTTP 或 mixed-port 地址，不能使用 SOCKS 地址。')
          throw new Error(normalizedProxy
            ? '网页直连与已配置代理均访问失败。请检查网站状态及系统代理/TUN 分流；也可用受管浏览器核验。'
            : '网页直连访问失败。请检查网站状态或配置可用代理；也可用受管浏览器核验。')
        }
      }
    }
    throw new Error('网页请求未取得响应。')
  }) as unknown as typeof globalThis.fetch

  return {
    fetch,
    async close() {
      // destroy 同时中断未读完的正文，取消或错误路径也不会遗留连接。
      const release = (dispatcher: Dispatcher | undefined): Promise<void> | undefined => {
        // Bun 的 undici 兼容对象没有连接池生命周期方法；Electron 的 Node 实现始终有 destroy。
        const managed = dispatcher as (Dispatcher & { destroy?: () => Promise<void> }) | undefined
        return managed?.destroy?.()
      }
      await Promise.allSettled([release(direct), release(proxy)])
    },
  }
}
