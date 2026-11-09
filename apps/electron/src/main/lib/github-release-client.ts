import { createHash } from 'node:crypto'
import type { GitHubRelease, GitHubReleaseListOptions } from '@gamma/shared'

export const GITHUB_RELEASE_REPO = { owner: 'xhslam', repo: 'Gamma' } as const
const API = `https://api.github.com/repos/${GITHUB_RELEASE_REPO.owner}/${GITHUB_RELEASE_REPO.repo}`
const WEB = `https://github.com/${GITHUB_RELEASE_REPO.owner}/${GITHUB_RELEASE_REPO.repo}`
const TTL = 30 * 60_000
interface CacheEntry { data: GitHubRelease[]; at: number }
interface Options { fetch: (url: string, init?: RequestInit) => Promise<Response>; now?: () => number }

function decodeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
    if (named[entity]) return named[entity]
    const code = entity.startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10)
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
}

/** Atom 是公开标签/发布订阅，不是安装清单；摘要不代表对应安装包已经发布。 */
export function parseReleaseFeed(xml: string): GitHubRelease[] {
  if (xml.length > 2_000_000 || !/<feed\b/.test(xml)) throw new Error('版本订阅响应无效')
  const entries: GitHubRelease[] = []
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1]!
    const url = decodeXml(entry.match(/<link\b[^>]*href="([^"]+)"/)?.[1] ?? '')
    if (!url.startsWith(`${WEB}/releases/tag/`)) continue
    const tag = decodeURIComponent(url.slice(`${WEB}/releases/tag/`.length))
    if (!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag)) continue
    const date = entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? ''
    if (!Number.isFinite(Date.parse(date))) continue
    const summary = decodeXml(entry.match(/<content\b[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '')
      .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()
    entries.push({ id: createHash('sha256').update(url).digest().readUIntBE(0, 6), tag_name: tag,
      name: `订阅摘要 · ${decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? tag)}`,
      body: `公开标签订阅摘要，不代表安装包已经发布；完整说明请查看 GitHub。\n\n${summary}`,
      draft: false, prerelease: !/^v?\d+\.\d+\.\d+$/.test(tag), created_at: date, published_at: date, html_url: url })
  }
  if (!entries.length) throw new Error('版本订阅未包含有效条目')
  return entries
}

export function createGitHubReleaseClient({ fetch: fetchFn, now = Date.now }: Options) {
  const cache = new Map<string, CacheEntry>()
  const pending = new Map<string, Promise<GitHubRelease[]>>()
  let limitedUntil = 0
  let feed: CacheEntry | undefined
  let feedPending: Promise<GitHubRelease[]> | undefined

  const request = (endpoint: string): Promise<GitHubRelease[]> => {
    const cached = cache.get(endpoint)
    if (cached && now() - cached.at < TTL) return Promise.resolve(cached.data)
    const inflight = pending.get(endpoint)
    if (inflight) return inflight
    const run = (async () => {
      if (now() < limitedUntil) throw new Error('GitHub API 请求过于频繁，稍后将自动重试')
      const response = await fetchFn(`${API}${endpoint}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) })
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        const retry = Number(response.headers.get('retry-after'))
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
        limitedUntil = Math.min(now() + 60 * 60_000, Math.max(now() + 60_000, retry > 0 ? now() + retry * 1000 : reset > now() ? reset : now() + 15 * 60_000))
        throw new Error('GitHub API 请求过于频繁，正在尝试公开版本订阅')
      }
      if (!response.ok) throw new Error(`GitHub 版本信息请求失败（${response.status}）`)
      const value: unknown = await response.json()
      const data = (Array.isArray(value) ? value : [value]).map(item => {
        if (!item || typeof item !== 'object') return item
        const release = item as Record<string, unknown>
        return { ...release, name: typeof release.name === 'string' ? release.name : release.tag_name, body: typeof release.body === 'string' ? release.body : '' }
      })
      if (!data.every(isRelease)) throw new Error('GitHub 版本数据无效')
      cache.set(endpoint, { data, at: now() })
      return data
    })()
    pending.set(endpoint, run)
    void run.finally(() => { if (pending.get(endpoint) === run) pending.delete(endpoint) }).catch(() => undefined)
    return run
  }
  const getFeed = (): Promise<GitHubRelease[]> => {
    if (feed && now() - feed.at < TTL) return Promise.resolve(feed.data)
    if (feedPending) return feedPending
    feedPending = (async () => {
      const response = await fetchFn(`${WEB}/releases.atom`, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('公开版本订阅暂时不可用')
      const data = parseReleaseFeed(await response.text())
      feed = { data, at: now() }
      return data
    })()
    const current = feedPending
    void current.finally(() => { if (feedPending === current) feedPending = undefined }).catch(() => undefined)
    return current
  }
  const listReleases = async (options: GitHubReleaseListOptions = {}): Promise<GitHubRelease[]> => {
    const perPage = options.perPage ?? 10, page = options.page ?? 1
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100 || !Number.isInteger(page) || page < 1) throw new Error('版本历史分页参数无效')
    const endpoint = `/releases?per_page=${perPage}&page=${page}`
    let data: GitHubRelease[]
    try { data = await request(endpoint) } catch (error) {
      const stale = cache.get(endpoint)
      if (stale) data = stale.data
      else if (page === 1) data = (await getFeed()).slice(0, perPage)
      else throw error
    }
    return data.filter(release => !release.draft && (options.includePrerelease || !release.prerelease))
  }
  return {
    listReleases,
    // 最新版本及指定版本仍只信任 API；绝不使用标签订阅来决定更新或资产下载。
    getLatestRelease: async (): Promise<GitHubRelease | null> => { try { return (await request('/releases/latest'))[0] ?? null } catch { return cache.get('/releases/latest')?.data[0] ?? null } },
    getReleaseByTag: async (tag: string): Promise<GitHubRelease | null> => {
      if (!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag)) return null
      const endpoint = `/releases/tags/${encodeURIComponent(tag)}`
      try { return (await request(endpoint))[0] ?? null } catch { return cache.get(endpoint)?.data[0] ?? null }
    },
    clearReleaseCache: (): void => { cache.clear(); feed = undefined },
  }
}

function isRelease(value: unknown): value is GitHubRelease {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'number' && typeof v.tag_name === 'string' && typeof v.name === 'string' && typeof v.body === 'string'
    && typeof v.draft === 'boolean' && typeof v.prerelease === 'boolean' && typeof v.created_at === 'string' && typeof v.published_at === 'string'
    && typeof v.html_url === 'string' && v.html_url.startsWith(`${WEB}/releases/tag/`)
}
