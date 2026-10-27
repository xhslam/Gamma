import { describe, expect, test } from 'bun:test'
import { canFetchWebRemotely } from './web-remote-fetch-policy'

describe('远端网页地址边界', () => {
  test('Given a public domain including a TUN fake IP When checking fallback Then permits remote public DNS resolution', async () => {
    for (const address of ['203.0.113.5', '198.18.0.5', '198.19.0.9', '2606:4700:4700::1111']) {
      expect(await canFetchWebRemotely('https://yz.chsi.com.cn/', { lookupHost: async () => [address] })).toBe(true)
    }
  })

  test('Given local hosts, address literals, credentials or authentication query When checking fallback Then refuses before DNS', async () => {
    let lookups = 0
    const lookupHost = async (): Promise<string[]> => { lookups++; return ['203.0.113.5'] }
    for (const url of [
      'http://localhost', 'http://127.0.0.1', 'http://[::1]', 'http://10.0.0.2', 'http://printer',
      'https://vault.local', 'https://app.internal', 'https://docs.example.test',
      'https://user:password@example.com/', 'file:///etc/passwd',
      'https://example.com/?access_token=private', 'https://example.com/?api_key=private',
      'https://example.com/?X-Amz-Signature=private', 'https://example.com/?code=private',
    ]) {
      expect(await canFetchWebRemotely(url, { lookupHost })).toBe(false)
    }
    expect(lookups).toBe(0)
  })

  test('Given a public-looking domain resolving privately or to mixed addresses When checking fallback Then keeps the URL local', async () => {
    for (const addresses of [
      ['127.0.0.1'], ['10.0.0.1'], ['192.168.1.1'], ['172.16.0.1'], ['169.254.169.254'],
      ['100.64.0.1'], ['::1'], ['fd00::1'], ['fe80::1'], ['::ffff:127.0.0.1'],
      ['203.0.113.5', '192.168.1.1'], [],
    ]) {
      expect(await canFetchWebRemotely('https://private.example.com/', { lookupHost: async () => addresses })).toBe(false)
    }
  })

  test('Given camelCase、snake_case 或复合认证参数 When 检查远端边界 Then 在 DNS 前拒绝 URL 外发', async () => {
    let lookups = 0
    const lookupHost = async (): Promise<string[]> => { lookups++; return ['203.0.113.5'] }
    for (const key of [
      'accessToken', 'refreshToken', 'idToken', 'oauthToken', 'authToken', 'auth_token',
      'session', 'sessionid', 'session_id', 'JSESSIONID', 'jwt', 'ticket', 'client_secret',
      'apiKey', 'auth-key', 'X-Amz-Credential', 'X-Goog-Signature', 'token[]',
    ]) {
      expect(await canFetchWebRemotely(`https://example.com/?${encodeURIComponent(key)}=private`, { lookupHost })).toBe(false)
    }
    expect(lookups).toBe(0)
  })

  test('Given 普通公开查询且正文关键词包含 token When 检查远端边界 Then 保留公开检索和 TUN fake IP 兼容性', async () => {
    expect(await canFetchWebRemotely('https://example.com/docs?page=2&q=token+authentication&format=html', {
      lookupHost: async () => ['198.18.0.5'],
    })).toBe(true)
  })

  test('Given DNS cannot verify the target When checking fallback Then does not send the URL remotely', async () => {
    expect(await canFetchWebRemotely('https://example.com/', { lookupHost: async () => { throw new Error('DNS failure') } })).toBe(false)
  })

  test('Given cancellation while resolving DNS When checking fallback Then releases the wait promptly', async () => {
    const controller = new AbortController()
    const pending = canFetchWebRemotely('https://example.com/', { signal: controller.signal, lookupHost: () => new Promise(() => {}) })
    controller.abort()
    expect(await pending).toBe(false)
  })
})
