import { describe, expect, test } from 'bun:test'
import type { GitHubRelease } from '@gamma/shared'
import { createGitHubReleaseClient, parseReleaseFeed } from './github-release-client'

const release = (tag = 'v0.19.260'): GitHubRelease => ({ id: 1, tag_name: tag, name: tag, body: '更新说明', draft: false, prerelease: false, created_at: '2026-11-09T12:00:00Z', published_at: '2026-11-09T12:00:00Z', html_url: `https://github.com/xhslam/Gamma/releases/tag/${tag}` })
const xml = `<feed><entry><updated>2026-11-09T12:00:00Z</updated><link href="https://github.com/xhslam/Gamma/releases/tag/v0.19.260"/><title>Gamma &amp; 更新</title><content type="html">&lt;p&gt;公开说明&lt;/p&gt;</content></entry><entry><updated>2026-11-09T12:00:00Z</updated><link href="https://github.com/xhslam/Gamma/releases/tag/v0.19.261-beta.1"/><title>beta</title></entry></feed>`

describe('Given 版本历史与安装清单分离的 GitHub 客户端', () => {
  test('When 多个窗口同时查询同一页 Then 合并 API 请求并缓存结果', async () => {
    let calls = 0
    const client = createGitHubReleaseClient({ fetch: async () => { calls++; return Response.json([release()]) } })
    const results = await Promise.all([client.listReleases(), client.listReleases(), client.listReleases()])
    expect(calls).toBe(1)
    expect(results[0]?.[0]?.tag_name).toBe('v0.19.260')
    await client.listReleases()
    expect(calls).toBe(1)
  })
  test('When 首次启动匿名 API 限流 Then 浏览历史回退公开订阅，但最新安装版本不使用订阅', async () => {
    const urls: string[] = []
    const client = createGitHubReleaseClient({ fetch: async url => {
      urls.push(url)
      return url.endsWith('.atom') ? new Response(xml) : new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '120' } })
    } })
    const history = await client.listReleases({ perPage: 3 })
    expect(history).toHaveLength(1)
    expect(history[0]?.name).toContain('订阅摘要')
    expect(history[0]?.body).toContain('不代表安装包已经发布')
    expect(await client.getLatestRelease()).toBeNull()
    expect(await client.getReleaseByTag('v0.19.260')).toBeNull()
    await client.listReleases({ perPage: 3 })
    expect(urls).toHaveLength(2)
  })
  test('When 权限型403未耗尽配额 Then 不错误进入15分钟全局冷却', async () => {
    let apiCalls = 0
    const client = createGitHubReleaseClient({ fetch: async url => {
      if (url.endsWith('.atom')) return new Response(xml)
      apiCalls++; return apiCalls === 1 ? new Response('', { status: 403 }) : Response.json(release())
    } })
    await client.listReleases()
    expect(await client.getLatestRelease()).toEqual(release())
    expect(apiCalls).toBe(2)
  })
  test('When 页码或页大小不同 Then 不串用第一页缓存，也不以第一页回退冒充历史第二页', async () => {
    let offline = false
    const client = createGitHubReleaseClient({ fetch: async url => {
      if (offline) throw new Error('offline')
      return Response.json([release(url.includes('page=2') ? 'v0.19.250' : 'v0.19.260')])
    } })
    expect((await client.listReleases({ page: 1 }))[0]?.tag_name).toBe('v0.19.260')
    expect((await client.listReleases({ page: 2 }))[0]?.tag_name).toBe('v0.19.250')
    offline = true
    expect((await client.listReleases({ page: 2 }))[0]?.tag_name).toBe('v0.19.250')
    await expect(client.listReleases({ page: 3 })).rejects.toThrow('offline')
  })
  test('When 缓存过期且网络不可用 Then 返回同一查询的旧数据', async () => {
    let time = 0, fail = false
    const client = createGitHubReleaseClient({ now: () => time, fetch: async () => { if (fail) throw new Error('offline'); return Response.json([release()]) } })
    await client.listReleases()
    time = 31 * 60_000; fail = true
    expect(await client.listReleases()).toEqual([release()])
  })
  test('When API 的名称和说明为null Then 使用真实标签与空说明而非拒绝整个列表', async () => {
    const client = createGitHubReleaseClient({ fetch: async () => Response.json([{ ...release(), name: null, body: null }, { ...release(), id: 2, draft: true }]) })
    expect(await client.listReleases()).toEqual([{ ...release(), name: release().tag_name, body: '' }])
  })
  test('When 订阅来自其他仓库、响应过大或分页无效 Then 拒绝而不发起任意URL请求', async () => {
    expect(() => parseReleaseFeed(xml.replaceAll('xhslam/Gamma', 'evil/repo'))).toThrow()
    expect(() => parseReleaseFeed('x'.repeat(2_000_001))).toThrow()
    const client = createGitHubReleaseClient({ fetch: async () => { throw new Error('不得请求') } })
    await expect(client.listReleases({ page: 0 })).rejects.toThrow('分页')
    expect(await client.getReleaseByTag('../../other')).toBeNull()
  })
})
