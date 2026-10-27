import { assertWebUrl } from './web-network'
import { callExaWebTool, ExaWebServiceError } from './exa-web-service'
import type { ExaWebOptions } from './exa-web-service'

export interface RemoteWebFetchInput {
  url: string
  maxChars: number
}

export interface RemoteWebFetchResult {
  url: string
  title: string
  content: string
  contentType: 'text/markdown'
  truncated: boolean
  route: 'exa'
  freshness: 'unknown'
}

/** 仅解析服务顶端元数据；正文中的标题、URL 和日期全部作为原文保留。 */
function parseRemotePage(text: string, maxChars: number): RemoteWebFetchResult {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  const match = /^# ([^\n]+)\nURL: ([^\n]+)\n(?:(?:Published|Author):[^\n]*\n)*\n([\s\S]+)$/.exec(normalized)
  if (!match) throw new Error('远端正文服务未返回有效网页内容。')
  const title = match[1]!.trim()
  const url = assertWebUrl(match[2]!.trim()).href
  const body = match[3]!.trim()
  if (!title || !body || /^(?:No content found\b|Error fetching\b|web_fetch_exa error\b)/i.test(body)) {
    throw new Error('远端正文服务未返回有效网页内容。')
  }
  return {
    title,
    url,
    content: body.slice(0, maxChars),
    contentType: 'text/markdown',
    truncated: body.length > maxChars,
    route: 'exa',
    // 官方 MCP 不暴露缓存来源和抓取时间，不能把取回内容表述为实时页面。
    freshness: 'unknown',
  }
}

/** 读取一个公开目标的远端正文；不携带登录态，也不抓取正文图片、favicon 或关联链接。 */
export async function fetchWebRemotely(input: RemoteWebFetchInput, options: ExaWebOptions = {}): Promise<RemoteWebFetchResult> {
  const url = assertWebUrl(input.url).href
  if (!Number.isSafeInteger(input.maxChars) || input.maxChars < 1 || input.maxChars >= Number.MAX_SAFE_INTEGER) {
    throw new Error('网页正文字符预算必须为正整数。')
  }
  try {
    const result = await callExaWebTool('web_fetch_exa', {
      urls: [url],
      // 多取一个字符以识别预算截断；官方返回值本身没有截断标志。
      maxCharacters: input.maxChars + 1,
    }, options)
    const textBlocks = result.content
      .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
    // 单个 URL 的官方工具只返回一段文本，混合错误与正文时不猜测其含义。
    if (textBlocks.length !== 1) throw new Error('远端正文服务未返回有效网页内容。')
    return parseRemotePage(textBlocks[0]!.text, input.maxChars)
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('网页远端读取已取消。', 'AbortError')
    if (error instanceof ExaWebServiceError && error.reason === 'timeout') throw new Error('网页远端读取超时，请稍后重试。')
    if (error instanceof ExaWebServiceError && error.reason === 'rate-limit') throw new Error('远端正文服务达到免费使用限额，请稍后重试。')
    throw new Error('远端正文服务未返回有效网页内容。')
  }
}
