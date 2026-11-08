import { describe, expect, test } from 'bun:test'
import { fetchOfficialAsset } from './prepare-officecli'

const source = 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-x64.exe'
describe('Given OfficeCLI 官方下载和固定资产 API', () => {
  test('When 普通地址成功 Then 直接采用且不请求 API', async () => {
    const urls: string[] = []
    const response = await fetchOfficialAsset(source, 529408477, async url => {
      urls.push(url.href)
      return new Response('binary')
    })
    expect(await response.text()).toBe('binary')
    expect(urls).toEqual([source])
  })
  for (const networkError of [false, true]) {
    test(`When 普通地址${networkError ? '断连' : '返回 504'} Then 通过固定官方 API 的重定向取得二进制`, async () => {
      const urls: string[] = []
      const response = await fetchOfficialAsset(source, 529408477, async (url, options) => {
        urls.push(url.href)
        expect(new Headers(options.headers).get('Accept')).toBe('application/octet-stream')
        if (urls.length === 1) {
          if (networkError) throw new Error('ECONNRESET')
          return new Response('', { status: 504 })
        }
        if (urls.length === 2) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } })
        return new Response('binary')
      })
      expect(await response.text()).toBe('binary')
      expect(urls).toEqual([source, 'https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/assets/529408477', 'https://release-assets.githubusercontent.com/asset'])
    })
  }
  test('When 文件不存在或两个入口均失败 Then 报错且不无限重试', async () => {
    for (const status of [404, 504]) {
      let calls = 0
      await expect(fetchOfficialAsset(source, 1, async () => {
        calls++
        return new Response('', { status })
      })).rejects.toThrow(`HTTP ${status}`)
      expect(calls).toBe(status === 404 ? 1 : 2)
    }
  })
  test('When 重定向离开官方域名 Then 拒绝下载', async () => {
    let calls = 0
    await expect(fetchOfficialAsset(source, 1, async () => {
      calls++
      return new Response(null, { status: 302, headers: { location: 'https://example.com/asset' } })
    })).rejects.toThrow('不受信任')
    expect(calls).toBe(1)
  })
})
