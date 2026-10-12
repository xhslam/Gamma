import { describe, expect, test } from 'bun:test'
import { fetchWeb } from './web-fetch-service'
import type { WebFetchOptions } from './web-fetch-service'

interface TimeoutRaceResult {
  scenario: string
  error: string
  remoteUrls: string[]
}

function testOptions(fetchImplementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): {
  options: WebFetchOptions
  remoteUrls: string[]
} {
  const remoteUrls: string[] = []
  const options: WebFetchOptions = {
    fetch: fetchImplementation as unknown as typeof globalThis.fetch,
    lookupHost: async () => ['203.0.113.5'],
    remoteFetch: async (input, requestOptions) => {
      requestOptions?.signal?.throwIfAborted()
      remoteUrls.push(input.url)
      return { url: input.url, title: '研招网公开公告', content: '已取得公开正文', contentType: 'text/markdown', truncated: false, route: 'exa', freshness: 'unknown' }
    },
  }
  return { options, remoteUrls }
}

describe('本地网页读取的远端回退', () => {
  test('Given a public website inaccessible locally When remote content is available Then returns the exact source and unknown freshness', async () => {
    const { options, remoteUrls } = testOptions(async () => { throw new Error('connection reset') })
    const result = await fetchWeb({ url: 'https://yz.chsi.com.cn/notice#section' }, options)
    expect(result).toMatchObject({ url: 'https://yz.chsi.com.cn/notice', route: 'exa', freshness: 'unknown', content: '已取得公开正文' })
    expect(remoteUrls).toEqual(['https://yz.chsi.com.cn/notice'])
  })

  test('Given a successful local request When fetching Then avoids remote calls and DNS policy work', async () => {
    const { options, remoteUrls } = testOptions(async () => new Response('当前公开正文', { headers: { 'Content-Type': 'text/plain' } }))
    let lookups = 0
    options.lookupHost = async () => { lookups++; return ['203.0.113.5'] }
    const result = await fetchWeb({ url: 'https://yz.chsi.com.cn/notice' }, options)
    expect(result).toMatchObject({ route: 'direct', content: '当前公开正文' })
    expect(remoteUrls).toEqual([])
    expect(lookups).toBe(0)
  })

  test('Given a public redirect followed by a network failure When fetching Then remote reads only the last verified public URL', async () => {
    let requests = 0
    const { options, remoteUrls } = testOptions(async () => {
      if (++requests === 1) return new Response(null, { status: 302, headers: { location: 'https://example.com/article' } })
      throw new Error('connection reset')
    })
    expect(await fetchWeb({ url: 'https://yz.chsi.com.cn/' }, options)).toMatchObject({ url: 'https://example.com/article' })
    expect(remoteUrls).toEqual(['https://example.com/article'])
  })

  test('Given private URLs, authenticated URLs or a redirect into private space When local access fails Then does not disclose any URL to the remote provider', async () => {
    for (const url of ['http://127.0.0.1/private', 'https://example.com/?access_token=private']) {
      const { options, remoteUrls } = testOptions(async () => { throw new Error('connection reset') })
      await expect(fetchWeb({ url }, options)).rejects.toThrow('connection reset')
      expect(remoteUrls).toEqual([])
    }
    let requests = 0
    const { options, remoteUrls } = testOptions(async () => {
      if (++requests === 1) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
      throw new Error('private network failure')
    })
    await expect(fetchWeb({ url: 'https://example.com/' }, options)).rejects.toThrow('private network failure')
    expect(remoteUrls).toEqual([])
  })

  test('Given user cancellation during a local request When it fails Then does not turn cancellation into a remote request', async () => {
    const controller = new AbortController()
    const { options, remoteUrls } = testOptions(async (_input, init) => {
      controller.abort()
      init?.signal?.throwIfAborted()
      return new Response('never')
    })
    options.signal = controller.signal
    await expect(fetchWeb({ url: 'https://example.com/' }, options)).rejects.toHaveProperty('name', 'AbortError')
    expect(remoteUrls).toEqual([])
  })

  test('Given camelCase 或会话认证 URL When 本地读取失败 Then 认证地址不会进入远端服务', async () => {
    for (const key of ['accessToken', 'auth_token', 'authToken', 'sessionid', 'jwt']) {
      const { options, remoteUrls } = testOptions(async () => { throw new Error('connection reset') })
      await expect(fetchWeb({ url: `https://example.com/?${key}=private` }, options)).rejects.toThrow('connection reset')
      expect(remoteUrls).toEqual([])
    }
  })

  test('Given 本地截止时间与登录、404、配额或超限错误同时发生 When 处理失败 Then 终态错误不会被改成远端成功', async () => {
    // 只在隔离子进程中控制本地截止信号，避免修改其他测试使用的 AbortSignal。
    const moduleUrl = new URL('./web-fetch-service.ts', import.meta.url).href
    const source = `
      import { fetchWeb } from ${JSON.stringify(moduleUrl)};
      const originalTimeout = AbortSignal.timeout;
      let localDeadline = new AbortController();
      AbortSignal.timeout = (milliseconds) => milliseconds === 30000 ? localDeadline.signal : originalTimeout(milliseconds);
      const results = [];
      try {
        for (const scenario of ['401', '404', '429', 'oversized']) {
          localDeadline = new AbortController();
          const remoteUrls = [];
          let error;
          try {
            await fetchWeb({ url: 'https://example.com/article' }, {
              fetch: async () => {
                localDeadline.abort();
                return scenario === 'oversized'
                  ? new Response('data', { headers: { 'Content-Type': 'text/plain', 'Content-Length': '6000000' } })
                  : new Response('error', { status: Number(scenario) });
              },
              lookupHost: async () => ['203.0.113.5'],
              remoteFetch: async (input) => {
                remoteUrls.push(input.url);
                return { url: input.url, title: 'remote', content: 'cached', contentType: 'text/markdown', route: 'exa', freshness: 'unknown', truncated: false };
              },
            });
          } catch (value) { error = value.message; }
          results.push({ scenario, error, remoteUrls });
        }
      } finally { AbortSignal.timeout = originalTimeout; }
      console.log(JSON.stringify(results));
    `
    const child = Bun.spawn([process.execPath, '-e', source], { stdout: 'pipe', stderr: 'pipe' })
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, errors }).toEqual({ exitCode: 0, errors: '' })
    const results = JSON.parse(output) as TimeoutRaceResult[]
    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result.error).toContain(result.scenario === 'oversized' ? '5 MB' : `HTTP ${result.scenario}`)
      expect(result.remoteUrls).toEqual([])
    }
  })

  test('Given 401, 404, 429, binary or an oversized page When fetching Then retains local failure without remote fallback', async () => {
    for (const status of [401, 404, 429]) {
      const { options, remoteUrls } = testOptions(async () => new Response('error', { status }))
      await expect(fetchWeb({ url: 'https://example.com/' }, options)).rejects.toThrow(`HTTP ${status}`)
      expect(remoteUrls).toEqual([])
    }
    const unsupportedResponseHeaders: HeadersInit[] = [
      { 'Content-Type': 'application/pdf' },
      { 'Content-Type': 'text/plain', 'Content-Length': '6000000' },
    ]
    for (const headers of unsupportedResponseHeaders) {
      const { options, remoteUrls } = testOptions(async () => new Response('data', { headers }))
      await expect(fetchWeb({ url: 'https://example.com/' }, options)).rejects.toThrow()
      expect(remoteUrls).toEqual([])
    }
  })

  test('Given a body transport interruption When a public page has remote content Then retries the source remotely', async () => {
    const { options, remoteUrls } = testOptions(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('body reset')) } }), { headers: { 'Content-Type': 'text/plain' } }))
    expect(await fetchWeb({ url: 'https://example.com/article' }, options)).toMatchObject({ route: 'exa' })
    expect(remoteUrls).toEqual(['https://example.com/article'])
  })

  test('Given both local and remote failures When fetching Then reports both failures without implying any body was retrieved', async () => {
    const { options } = testOptions(async () => { throw new Error('connection reset') })
    options.remoteFetch = async () => { throw new Error('远端服务达到免费使用限额。') }
    await expect(fetchWeb({ url: 'https://example.com/article' }, options)).rejects.toThrow('免费使用限额')
  })
})
