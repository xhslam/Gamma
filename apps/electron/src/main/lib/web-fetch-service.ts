/** 静态公开网页读取：有界 GET、逐跳重新路由、成熟 HTML → Markdown 转换。 */
import TurndownService from 'turndown'
import { assertWebUrl, createManagedWebFetch } from './web-network'
import type { WebRequestRoute } from './web-network'
import { fetchWebRemotely } from './web-remote-fetch-service'
import { canFetchWebRemotely } from './web-remote-fetch-policy'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 8
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export interface WebFetchInput {
  url: string
  maxChars?: number
}

export interface WebFetchOptions {
  proxyUrl?: string
  signal?: AbortSignal
  /** 服务层注入用于离线回归验证，不暴露给 Agent 工具参数。 */
  fetch?: typeof globalThis.fetch
  remoteFetch?: typeof fetchWebRemotely
  lookupHost?: (hostname: string) => Promise<string[]>
}

export interface WebFetchResult {
  url: string
  title: string
  content: string
  contentType: string
  truncated: boolean
  route: WebRequestRoute | 'exa'
  /** 远端服务没有提供抓取时间，不能把工具取回时间当网页更新时间。 */
  freshness?: 'unknown'
}

class RemoteFetchEligibleError extends Error {
  constructor(readonly url: string, message: string) { super(message) }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('网页正文超过 5 MB，请缩小读取范围或使用受管浏览器。')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('网页正文超过 5 MB，请缩小读取范围或使用受管浏览器。')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const encoding = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1]
  if (encoding) {
    try { return new TextDecoder(encoding).decode(bytes) } catch { /* 无效字符集回退 UTF-8 */ }
  }
  // 旧国内页面常只在 meta 中声明 GBK；仅检查有限头部。
  const prefix = new TextDecoder().decode(bytes.subarray(0, 2048))
  const metaEncoding = /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'/>]+)/i.exec(prefix)?.[1]
  try { return new TextDecoder(metaEncoding ?? 'utf-8').decode(bytes) } catch { return new TextDecoder().decode(bytes) }
}

export function convertWebContent(text: string, contentType: string, url: string): { title: string; content: string } {
  if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return { title: url, content: text }
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  converter.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'head', 'title', 'meta', 'link'])
  // 相对链接按最终响应 URL 解析，保证引用可以独立打开。
  converter.addRule('absoluteLinks', {
    filter: 'a',
    replacement(content, node) {
      const href = node.getAttribute('href')
      if (!href) return content
      try {
        const target = assertWebUrl(new URL(href, url).href)
        return `[${content || target.href}](${target.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
      } catch { return content }
    },
  })
  const titleHtml = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]
  const title = titleHtml ? new TurndownService().turndown(titleHtml).trim() : url
  return { title: title || url, content: converter.turndown(text).trim() }
}

async function fetchWebLocally(input: WebFetchInput, options: WebFetchOptions): Promise<WebFetchResult> {
  let url = assertWebUrl(input.url).href
  const maxChars = input.maxChars ?? 30_000
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 60_000) throw new Error('maxChars 必须是 1–60000 的整数。')
  options.signal?.throwIfAborted()
  // 同一次工具调用的总时限包括重定向和正文读取。
  const deadline = AbortSignal.timeout(60_000)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  let route: WebRequestRoute = 'direct'
  const network = createManagedWebFetch(options.proxyUrl, { onRoute: (_url, value) => { route = value } })
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (signal.aborted) throw new RemoteFetchEligibleError(url, '本地网页读取超时或取消。')
      let response: Response
      try { response = await (options.fetch ?? network.fetch)(url, {
        signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'Gamma/1.0', Accept: 'text/markdown, text/html, text/plain, application/json;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      }) } catch (error) {
        throw new RemoteFetchEligibleError(url, error instanceof Error ? error.message : '本地网页请求失败。')
      }
      if (REDIRECT_STATUS.has(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location) throw new Error('网站返回重定向，但没有目标地址。')
        if (redirects === MAX_REDIRECTS) throw new Error('网站重定向次数过多。')
        url = assertWebUrl(new URL(location, url).href).href
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        const message = `网站返回 HTTP ${response.status}。需要登录、动态内容或访问验证时，请使用受管浏览器。`
        if ([403, 408, 451, 500, 502, 503, 504].includes(response.status)) throw new RemoteFetchEligibleError(url, message)
        throw new Error(message)
      }
      const contentType = response.headers.get('content-type') ?? 'text/plain'
      if (!/^(?:text\/|application\/(?:json|[\w.-]+\+json|xml|[\w.-]+\+xml|xhtml\+xml))/i.test(contentType)) {
        await response.body?.cancel()
        throw new Error('该地址不是文本网页；PDF、图片或下载文件请使用浏览器或对应文件工具。')
      }
      let bytes: Uint8Array
      try { bytes = await readBoundedBody(response) } catch (error) {
        if (error instanceof Error && error.message.includes('5 MB')) throw error
        throw new RemoteFetchEligibleError(url, '本地网页正文读取中断。')
      }
      const converted = convertWebContent(decodeBody(bytes, contentType), contentType, url)
      if (!converted.content) throw new RemoteFetchEligibleError(url, '网页没有可读取的静态正文，请使用受管浏览器检查动态内容。')
      return { url, title: converted.title, content: converted.content.slice(0, maxChars), contentType, truncated: converted.content.length > maxChars, route }
    }
    throw new Error('网站重定向次数过多。')
  } finally {
    await network.close()
  }
}

/** 本机读取失败后复用远端公开正文服务；取消、内网及认证地址不触发第三方请求。 */
export async function fetchWeb(input: WebFetchInput, options: WebFetchOptions = {}): Promise<WebFetchResult> {
  const initialUrl = assertWebUrl(input.url).href
  const maxChars = input.maxChars ?? 30_000
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 60_000) throw new Error('maxChars 必须是 1–60000 的整数。')
  options.signal?.throwIfAborted()
  const deadline = AbortSignal.timeout(60_000)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  const localSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  try {
    return await fetchWebLocally({ url: initialUrl, maxChars }, { ...options, signal: localSignal })
  } catch (error) {
    signal.throwIfAborted()
    const remoteUrl = error instanceof RemoteFetchEligibleError ? error.url : initialUrl
    // 本地阶段超时可以尝试远端；格式错误、下载、超限、404 和登录要求仍直接报错。
    // 本地截止时间不能覆盖已经确定的 401/404/429、下载或超限错误。
    if (!(error instanceof RemoteFetchEligibleError)) throw error
    if (!await canFetchWebRemotely(remoteUrl, { signal, lookupHost: options.lookupHost })) {
      signal.throwIfAborted()
      throw error
    }
    signal.throwIfAborted()
    const url = new URL(remoteUrl)
    url.hash = ''
    try {
      const result = await (options.remoteFetch ?? fetchWebRemotely)({ url: url.href, maxChars }, { proxyUrl: options.proxyUrl, signal })
      signal.throwIfAborted()
      return result
    } catch (remoteError) {
      signal.throwIfAborted()
      const reason = remoteError instanceof Error ? remoteError.message : '远端正文服务读取失败。'
      throw new Error(`本地请求与远端公开正文服务均读取失败。${reason} 请使用受管浏览器核验；失败不代表已取得网页正文。`)
    }
  }
}
