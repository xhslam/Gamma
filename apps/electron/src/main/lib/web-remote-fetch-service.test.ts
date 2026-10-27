import { describe, expect, test } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { fetchWebRemotely } from './web-remote-fetch-service'

interface FetchArguments {
  urls: string[]
  maxCharacters?: number
}

async function createFetchServer(reply: CallToolResult) {
  const calls: FetchArguments[] = []
  const methods: string[] = []
  const signals: AbortSignal[] = []
  const mcp = new McpServer({ name: 'mock-exa-fetch', version: '1.0.0' })
  mcp.registerTool('web_fetch_exa', {
    inputSchema: z.object({
      urls: z.array(z.string()).length(1),
      maxCharacters: z.number().min(1).optional(),
    }).strict(),
  }, (args) => { calls.push(args); return reply })
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
    fetch: mockFetch, calls, methods, signals,
    close: async () => { await mcp.close(); await server.stop(true) },
  }
}

const TARGET_URL = 'https://yz.chsi.com.cn/kyzx/notice.html'

describe('公开网页远端正文读取', () => {
  test('Given 当前官方严格 schema 与正文内 URL When 通过真实 SDK 读取 Then 只解析顶端来源且不下载额外图片', async () => {
    const server = await createFetchServer({ content: [
      { type: 'text', text: `# 招生公告\nURL: ${TARGET_URL}\nPublished: 2026-10-09\nAuthor: 教育部\n\n公告正文。\nURL: https://example.com/in-body\nPublished: 这里是原文。` },
      { type: 'image', data: 'AQ==', mimeType: 'image/png' },
    ] })
    try {
      const result = await fetchWebRemotely({ url: TARGET_URL, maxChars: 2000 }, { fetch: server.fetch })
      expect(server.methods).toContain('initialize')
      expect(server.methods).toContain('notifications/initialized')
      expect(server.methods).toContain('tools/call')
      expect(server.calls).toEqual([{ urls: [TARGET_URL], maxCharacters: 2001 }])
      expect(result).toEqual({
        title: '招生公告', url: TARGET_URL,
        content: '公告正文。\nURL: https://example.com/in-body\nPublished: 这里是原文。',
        contentType: 'text/markdown', truncated: false, route: 'exa', freshness: 'unknown',
      })
      expect('status' in result).toBe(false)
      expect(server.signals.every((signal) => signal.aborted)).toBe(true)
    } finally { await server.close() }
  })

  test('Given 正文超过预算 When 远端读取 Then 多请求一字符后按正文预算截断且保留来源', async () => {
    const server = await createFetchServer({ content: [{ type: 'text', text: `# 公告\nURL: ${TARGET_URL}\n\n${'文'.repeat(13)}` }] })
    try {
      const result = await fetchWebRemotely({ url: TARGET_URL, maxChars: 12 }, { fetch: server.fetch })
      expect(server.calls[0]?.maxCharacters).toBe(13)
      expect(result.content).toBe('文'.repeat(12))
      expect(result.truncated).toBe(true)
      expect(result.url).toBe(TARGET_URL)
    } finally { await server.close() }
  })

  test('Given 服务返回合法的跳转后来源 When 远端读取 Then 标记实际来源且不宣称实时抓取', async () => {
    const canonicalUrl = 'https://yz.chsi.com.cn/kyzx/canonical.html'
    const server = await createFetchServer({ content: [{ type: 'text', text: `# 公告\nURL: ${canonicalUrl}\n\n原文。` }] })
    try {
      const result = await fetchWebRemotely({ url: TARGET_URL, maxChars: 100 }, { fetch: server.fetch })
      expect(result.url).toBe(canonicalUrl)
      expect(result.freshness).toBe('unknown')
    } finally { await server.close() }
  })

  const invalidReplies: CallToolResult[] = [
    { content: [] },
    { content: [{ type: 'text', text: 'No content found for the provided URL(s).' }] },
    { content: [{ type: 'text', text: 'Error fetching URL(s): timed out' }] },
    { isError: true, content: [{ type: 'text', text: `# 公告\nURL: ${TARGET_URL}\n\n这不是有效正文。` }] },
    { content: [{ type: 'text', text: `# 公告\nURL: ${TARGET_URL}\nPublished: 2026-10-09\n\n  ` }] },
    { content: [{ type: 'text', text: '# 公告\nURL: javascript:alert(1)\n\n无效来源。' }] },
    { content: [{ type: 'text', text: '# 公告\nURL: https://alice:secret@example.com/\n\n无效来源。' }] },
    { content: [{ type: 'text', text: `# 公告\nURL: ${TARGET_URL}\n\nNo content found.` }] },
    { content: [
      { type: 'text', text: `# 公告\nURL: ${TARGET_URL}\n\n原文。` },
      { type: 'text', text: 'Error fetching URL(s): timed out' },
    ] },
  ]
  for (const [index, reply] of invalidReplies.entries()) {
    test(`Given 空正文、错误或无效来源 ${index + 1} When 远端读取 Then 不将它伪造为成功正文`, async () => {
      const server = await createFetchServer(reply)
      try {
        await expect(fetchWebRemotely({ url: TARGET_URL, maxChars: 100 }, { fetch: server.fetch })).rejects.toThrow('未返回有效网页内容')
      } finally { await server.close() }
    })
  }

  test('Given SDK 已开始读取 When 用户取消 Then 取消网络与请求并释放连接', async () => {
    const server = await createFetchServer({ content: [{ type: 'text', text: `# 公告\nURL: ${TARGET_URL}\n\n原文。` }] })
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
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
      const pending = fetchWebRemotely({ url: TARGET_URL, maxChars: 100 }, { fetch: delayedFetch, signal: controller.signal })
      await started
      controller.abort()
      await expect(pending).rejects.toHaveProperty('name', 'AbortError')
      expect(server.signals.every((signal) => signal.aborted)).toBe(true)
    } finally { await server.close() }
  })

  test('Given 不支持的地址或无效预算 When 读取 Then 不发出网络请求', async () => {
    let count = 0
    const mockFetch = (async () => { count += 1; return new Response() }) as unknown as typeof globalThis.fetch
    await expect(fetchWebRemotely({ url: 'file:///secret', maxChars: 100 }, { fetch: mockFetch })).rejects.toThrow('HTTP(S)')
    await expect(fetchWebRemotely({ url: 'https://alice:secret@example.com/', maxChars: 100 }, { fetch: mockFetch })).rejects.toThrow('用户名或密码')
    await expect(fetchWebRemotely({ url: TARGET_URL, maxChars: 0 }, { fetch: mockFetch })).rejects.toThrow('正整数')
    expect(count).toBe(0)
  })
})
