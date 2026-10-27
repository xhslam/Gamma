import { describe, expect, test } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { searchWeb } from './web-search-service'

interface SearchArguments {
  query: string
  objective: string
  numResults?: number
}

interface MockSearchServer {
  fetch: typeof globalThis.fetch
  methods: string[]
  calls: SearchArguments[]
  signals: AbortSignal[]
  close: () => Promise<void>
}

async function createSearchServer(
  respond: (input: SearchArguments, signal: AbortSignal) => CallToolResult | Promise<CallToolResult>,
): Promise<MockSearchServer> {
  const methods: string[] = []
  const calls: SearchArguments[] = []
  const signals: AbortSignal[] = []
  const mcp = new McpServer({ name: 'test-search-provider', version: '1.0.0' })
  mcp.registerTool('web_search_exa', {
    inputSchema: z.object({
      query: z.string().min(1),
      objective: z.string().min(1).max(4096),
      numResults: z.number().int().min(1).max(10).optional(),
    }).strict(),
  }, (input, extra) => {
    calls.push(input)
    return Promise.resolve(respond(input, extra.signal))
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: () => crypto.randomUUID(),
  })
  await mcp.connect(transport)
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method === 'POST') {
        const payload: unknown = await request.clone().json()
        if (payload && typeof payload === 'object' && 'method' in payload && typeof payload.method === 'string') {
          methods.push(payload.method)
        }
      }
      return transport.handleRequest(request)
    },
  })
  const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://mcp.exa.ai/mcp')
    if (init?.signal) signals.push(init.signal)
    return fetch(server.url, init)
  }) as typeof globalThis.fetch
  return {
    fetch: mockFetch,
    methods,
    calls,
    signals,
    close: async () => {
      await mcp.close()
      await server.stop(true)
    },
  }
}

describe('联网搜索服务', () => {
  test('Given 官方当前的严格工具 schema When 通过真实 SDK 握手和检索 Then 发送 query 与 objective 并保留国内网页来源', async () => {
    const server = await createSearchServer(() => ({ content: [{ type: 'text', text: [
      'Title: 中国政府网',
      'URL: https://www.gov.cn/zhengce/',
      'Published: 2026-10-09',
      'Highlights:',
      '政策原文摘录。',
    ].join('\n') }] }))
    try {
      const result = await searchWeb({ query: '  最新政策  ' }, { fetch: server.fetch })
      expect(server.methods).toContain('initialize')
      expect(server.methods).toContain('notifications/initialized')
      expect(server.methods).toContain('tools/call')
      expect(server.calls).toHaveLength(1)
      expect(server.calls[0]?.query).toBe('最新政策')
      expect(server.calls[0]?.numResults).toBe(5)
      expect(server.calls[0]?.objective).toContain('原始来源')
      expect(result.query).toBe('最新政策')
      expect(result.provider).toBe('exa')
      expect(result.results).toEqual([{ title: '中国政府网', url: 'https://www.gov.cn/zhengce/', snippet: '政策原文摘录。' }])
      expect(result.text).toContain('https://www.gov.cn/zhengce/')
      expect(result.truncated).toBe(false)
      expect(Number.isNaN(Date.parse(result.searchedAt))).toBe(false)
      expect(server.signals.every((signal) => signal.aborted)).toBe(true)
    } finally { await server.close() }
  })

  test('Given 请求超过十条结果且正文很长 When 检索 Then 结果数量封顶且截断不丢失底部来源 URL', async () => {
    const server = await createSearchServer(() => ({ content: [{ type: 'text', text: [
      'Title: 很长的文章',
      'URL: https://example.com/long',
      'Highlights:',
      '正文'.repeat(15_000),
      '\n---\n',
      'Title: 第二个来源',
      'URL: https://example.com/second',
      'Highlights:',
      '第二份材料。',
    ].join('\n') }] }))
    try {
      const result = await searchWeb({ query: '检索长文章', numResults: 100 }, { fetch: server.fetch })
      expect(server.calls[0]?.numResults).toBe(10)
      expect(result.text.length).toBe(20_000)
      expect(result.truncated).toBe(true)
      expect(result.results[0]?.snippet.length).toBe(1_500)
      expect(result.results[1]?.url).toBe('https://example.com/second')
    } finally { await server.close() }
  })

  test('Given 服务返回空内容 When 检索 Then 明确返回空结果', async () => {
    const server = await createSearchServer(() => ({ content: [] }))
    try {
      const result = await searchWeb({ query: '不存在的信息' }, { fetch: server.fetch })
      expect(result.results).toEqual([])
      expect(result.text).toBe('未找到搜索结果。')
      expect(result.truncated).toBe(false)
    } finally { await server.close() }
  })

  test('Given 服务返回工具错误 When 检索 Then 失败且不把错误伪装成搜索结果', async () => {
    const server = await createSearchServer(() => ({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }))
    try {
      await expect(searchWeb({ query: '文档' }, { fetch: server.fetch })).rejects.toThrow('联网搜索失败')
    } finally { await server.close() }
  })

  test('Given 握手网络报错含代理凭证 When 检索 Then 用户错误不包含底层凭证', async () => {
    const failingFetch = (async () => { throw new Error('http://alice:secret@127.0.0.1:7890 failed') }) as unknown as typeof globalThis.fetch
    await expect(searchWeb({ query: '文档' }, { fetch: failingFetch })).rejects.toThrow('联网搜索失败，请检查网络连接或稍后重试。')
  })

  test('Given 官方服务返回 HTTP 429 When 检索 Then 明确告知免费限额而不重试规避', async () => {
    let requestCount = 0
    const limitedFetch = (async () => {
      requestCount += 1
      return new Response('Too Many Requests', { status: 429 })
    }) as unknown as typeof globalThis.fetch
    await expect(searchWeb({ query: '文档' }, { fetch: limitedFetch })).rejects.toThrow('免费使用限额')
    expect(requestCount).toBe(1)
  })

  test('Given 搜索已经开始 When 用户取消 Then 终止 SDK 请求和网络信号', async () => {
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const server = await createSearchServer(() => ({ content: [] }))
    const delayedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await server.fetch(input, init)
      if (typeof init?.body === 'string' && init.body.includes('"tools/call"')) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          markStarted()
        })
      }
      return response
    }) as typeof globalThis.fetch
    const controller = new AbortController()
    try {
      const pending = searchWeb({ query: '长时间搜索', signal: controller.signal }, { fetch: delayedFetch })
      await started
      controller.abort()
      await expect(pending).rejects.toHaveProperty('name', 'AbortError')
      expect(server.signals.some((signal) => signal.aborted)).toBe(true)
    } finally { await server.close() }
  })

  test('Given 握手没有响应 When 超过总截止时间 Then 取消网络并报告超时', async () => {
    let networkSignal: AbortSignal | undefined
    const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      networkSignal = init?.signal ?? undefined
      networkSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as typeof globalThis.fetch
    await expect(searchWeb({ query: '文档' }, { fetch: hangingFetch, timeoutMs: 20 })).rejects.toThrow('联网搜索超时')
    expect(networkSignal?.aborted).toBe(true)
  })

  test('Given 在开始前已取消或输入无效 When 搜索 Then 不发出网络请求', async () => {
    let fetchCount = 0
    const mockFetch = (async () => { fetchCount += 1; return new Response() }) as unknown as typeof globalThis.fetch
    const controller = new AbortController()
    controller.abort()
    await expect(searchWeb({ query: '文档', signal: controller.signal }, { fetch: mockFetch })).rejects.toHaveProperty('name', 'AbortError')
    await expect(searchWeb({ query: '   ' }, { fetch: mockFetch })).rejects.toThrow('不能为空')
    await expect(searchWeb({ query: '文档', numResults: 0 }, { fetch: mockFetch })).rejects.toThrow('正整数')
    await expect(searchWeb({ query: '文档', numResults: Number.NaN }, { fetch: mockFetch })).rejects.toThrow('正整数')
    expect(fetchCount).toBe(0)
  })
})
