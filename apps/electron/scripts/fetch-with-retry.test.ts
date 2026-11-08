import { describe, expect, test } from 'bun:test'
import { fetchWithRetry } from './fetch-with-retry'

describe('Given 构建资源下载的有限网络重试', () => {
  for (const statuses of [[200], [504, 200], [429, 503, 200], [404], [504, 504, 504]]) {
    test(`When HTTP 状态为 ${statuses.join('/')} Then 只重试临时故障且不掩盖最终失败`, async () => {
      let calls = 0
      const delays: number[] = []
      const response = await fetchWithRetry('https://github.com/example/asset', { redirect: 'manual' }, {
        fetch: async (_url, options) => {
          expect(options.redirect).toBe('manual')
          expect(options.signal).toBeInstanceOf(AbortSignal)
          return new Response('', { status: statuses[calls++]! })
        },
        sleep: async delay => { delays.push(delay) },
      })
      expect(response.status).toBe(statuses.at(-1)!)
      expect(calls).toBe(statuses.length)
      expect(delays).toEqual([10_000, 20_000].slice(0, calls - 1))
    })
  }
  test('When 网络持续断开 Then 三次失败后抛出原错误', async () => {
    let calls = 0
    const error = new Error('ECONNRESET')
    await expect(fetchWithRetry('https://github.com/example/asset', {}, {
      fetch: async () => { calls++; throw error }, sleep: async () => {},
    })).rejects.toBe(error)
    expect(calls).toBe(3)
  })
})
