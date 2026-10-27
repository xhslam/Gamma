import { afterEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import type { Server, RequestListener } from 'node:http'
import { encode } from 'iconv-lite'
import { convertWebContent, fetchWeb } from './web-fetch-service'

const servers: Server[] = []

async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器未启动')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

describe('静态网页读取', () => {
  test('Given a redirect to an HTML page When fetching Then returns the final source URL and clean Markdown', async () => {
    const base = await serve((request, response) => {
      if (request.url === '/') { response.writeHead(302, { location: '/article' }); response.end(); return }
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<html><head><title>研招信息</title><script>secret()</script></head><body><h1>报名流程</h1><p>查看<a href="/help">帮助</a></p><script>不可信脚本</script></body></html>')
    })
    const result = await fetchWeb({ url: base })
    expect(result.url).toBe(`${base}/article`)
    expect(result.title).toBe('研招信息')
    expect(result.content).toContain('# 报名流程')
    expect(result.content).toContain(`[帮助](${base}/help)`)
    expect(result.content).not.toContain('secret')
    expect(result.content).not.toContain('不可信脚本')
    expect(result.route).toBe('direct')
    expect(result.truncated).toBe(false)
  })

  test('Given a long textual response When maxChars is supplied Then reports truncation without inventing more content', async () => {
    const base = await serve((_, response) => { response.setHeader('Content-Type', 'text/plain'); response.end('中文内容'.repeat(20)) })
    expect(await fetchWeb({ url: base, maxChars: 12 })).toMatchObject({ content: '中文内容'.repeat(3), truncated: true })
    await expect(fetchWeb({ url: base, maxChars: 60_001 })).rejects.toThrow('maxChars')
  })

  test('Given a redirect into a local file When fetching Then rejects the redirect instead of reading it', async () => {
    const base = await serve((_, response) => { response.writeHead(302, { location: 'file:///etc/passwd' }); response.end() })
    await expect(fetchWeb({ url: base })).rejects.toThrow('HTTP(S)')
  })

  test('Given an unbounded chunked body When it exceeds the byte limit Then cancels and fails', async () => {
    const base = await serve((_, response) => {
      response.setHeader('Content-Type', 'text/plain')
      response.write(Buffer.alloc(3 * 1024 * 1024, 'a'))
      response.end(Buffer.alloc(3 * 1024 * 1024, 'b'))
    })
    await expect(fetchWeb({ url: base })).rejects.toThrow('5 MB')
  })

  test('Given a PDF or an access error When fetching Then gives actionable feedback instead of decoding binary or error content', async () => {
    const base = await serve((request, response) => {
      if (request.url === '/error') { response.writeHead(403); response.end('blocked'); return }
      response.setHeader('Content-Type', 'application/pdf'); response.end('%PDF')
    })
    await expect(fetchWeb({ url: base })).rejects.toThrow('不是文本网页')
    await expect(fetchWeb({ url: `${base}/error` })).rejects.toThrow('HTTP 403')
  })

  test('Given cancellation during the body When reading Then stops the request', async () => {
    const base = await serve((_, response) => { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.write('pending') })
    const controller = new AbortController()
    const pending = fetchWeb({ url: base }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 30)
    await expect(pending).rejects.toThrow()
  })

  test('Given script links and empty HTML When converting Then never emits executable links or fake text', () => {
    expect(convertWebContent('<p><a href="javascript:alert(1)">链接</a></p>', 'text/html', 'https://example.com').content).toBe('链接')
    expect(convertWebContent('<html><head><script>secret</script></head><body></body></html>', 'text/html', 'https://example.com').content).toBe('')
  })

  test('Given a domestic page declaring GBK only in meta When fetching Then decodes Chinese content correctly', async () => {
    const base = await serve((_, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end(encode('<html><head><meta charset="gbk"><title>研招网</title></head><body><p>研究生报名</p></body></html>', 'gbk'))
    })
    expect(await fetchWeb({ url: base })).toMatchObject({ title: '研招网', content: '研究生报名' })
  })

  test('Given a redirect loop When fetching Then stops at the redirect limit', async () => {
    let requests = 0
    const base = await serve((_, response) => { requests++; response.writeHead(302, { location: '/' }); response.end() })
    await expect(fetchWeb({ url: base })).rejects.toThrow('重定向次数过多')
    expect(requests).toBe(9)
  })
})
