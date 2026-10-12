import { callExaWebTool, ExaWebServiceError } from './exa-web-service'

const SEARCH_TIMEOUT_MS = 30_000
const MAX_TEXT_CHARACTERS = 20_000
const MAX_SNIPPET_CHARACTERS = 1_500

export interface WebSearchInput {
  query: string
  numResults?: number
  signal?: AbortSignal
}

export interface WebSearchOptions {
  proxyUrl?: string
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  /** 可缩短截止时间；单次检索始终不超过 30 秒。 */
  timeoutMs?: number
}

export interface WebSearchSource {
  title: string
  url: string
  snippet: string
}

export interface WebSearchResult {
  query: string
  searchedAt: string
  provider: 'exa'
  results: WebSearchSource[]
  text: string
  truncated: boolean
}

/** 保留服务给出的来源 URL，正文与摘录分别限长，避免挤占 Agent 上下文。 */
function formatSearchResult(query: string, text: string): WebSearchResult {
  let truncated = text.length > MAX_TEXT_CHARACTERS
  const results: WebSearchSource[] = []
  const seenUrls = new Set<string>()

  for (const block of text.split(/\n---\s*\n|\n(?=Title:\s)/)) {
    const urlText = /^URL:\s*(\S+)/m.exec(block)?.[1]
    if (!urlText) continue
    let url: URL
    try { url = new URL(urlText) } catch { continue }
    if (!['http:', 'https:'].includes(url.protocol) || seenUrls.has(url.href)) continue
    seenUrls.add(url.href)

    const title = /^Title:\s*([^\n]*)/m.exec(block)?.[1]?.trim() || url.hostname
    const highlightIndex = block.indexOf('Highlights:')
    const snippet = highlightIndex >= 0
      ? block.slice(highlightIndex + 'Highlights:'.length).trim()
      : block.replace(/^(?:Title|URL|Published|Author):[^\n]*(?:\n|$)/gm, '').trim()
    if (snippet.length > MAX_SNIPPET_CHARACTERS) truncated = true
    results.push({ title, url: url.href, snippet: snippet.slice(0, MAX_SNIPPET_CHARACTERS) })
  }

  return {
    query,
    searchedAt: new Date().toISOString(),
    provider: 'exa',
    results,
    text: text.slice(0, MAX_TEXT_CHARACTERS) || '未找到搜索结果。',
    truncated,
  }
}

/**
 * 复用 Exa 官方搜索服务与 MCP SDK；索引、抓取发生在服务端。
 * 请求独立持有网络资源，不继承 Pi runtime 修改的全局 fetch。
 */
export async function searchWeb(input: WebSearchInput, options: WebSearchOptions = {}): Promise<WebSearchResult> {
  const query = input.query.trim()
  if (!query) throw new Error('搜索关键词不能为空。')
  const requestedCount = input.numResults ?? 5
  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    throw new Error('搜索结果数量必须为正整数。')
  }
  const numResults = Math.min(requestedCount, 10)
  const requestedTimeout = options.timeoutMs ?? SEARCH_TIMEOUT_MS
  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) {
    throw new Error('搜索截止时间必须为正数。')
  }
  const timeoutMs = Math.min(requestedTimeout, SEARCH_TIMEOUT_MS)
  const externalSignals = [input.signal, options.signal].filter((value): value is AbortSignal => value !== undefined)
  const signal = externalSignals.length > 0 ? AbortSignal.any(externalSignals) : undefined

  try {
    const result = await callExaWebTool('web_search_exa', {
      query,
      numResults,
      // 当前官方 schema 要求 objective；旧版 OpenCode 的 type/livecrawl 已不适用。
      objective: '查找与用户查询直接相关的可靠网页，优先原始来源和官方文档，保留可核验的 URL 与正文摘录。',
    }, { ...options, signal, timeoutMs })
    const text = result.content
      .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
      .map((item) => item.text)
      .join('\n\n')
      .trim()
    return formatSearchResult(query, text)
  } catch (error) {
    if (externalSignals.some((value) => value.aborted)) {
      throw new DOMException('联网搜索已取消。', 'AbortError')
    }
    if (error instanceof ExaWebServiceError && error.reason === 'timeout') throw new Error('联网搜索超时，请稍后重试。')
    if (error instanceof ExaWebServiceError && error.reason === 'rate-limit') {
      throw new Error('联网搜索服务达到免费使用限额，请稍后重试。')
    }
    // 网络错误可能携带代理 URL，不将底层消息或 cause 交给用户与日志。
    throw new Error('联网搜索失败，请检查网络连接或稍后重试。')
  }
}
