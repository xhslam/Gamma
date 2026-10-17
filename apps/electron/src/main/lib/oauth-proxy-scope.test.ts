import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  buildOAuthNoProxy,
  readNoProxyEnvironment,
  runWithOAuthProxyScope,
  setEffectiveProxyUrlForTest,
} from './oauth-proxy-scope'
import { getPiRequestProxyDispatcher } from './adapters/pi-request-proxy'

const getEffectiveProxyUrl = mock<() => Promise<string | undefined>>()

afterEach(() => {
  getEffectiveProxyUrl.mockReset()
  setEffectiveProxyUrlForTest(undefined)
})


describe('OAuth proxy scope', () => {
  test('Given a user NO_PROXY list When building OAuth exclusions Then preserves it and includes every loopback host', () => {
    expect(buildOAuthNoProxy('internal.example,localhost')).toBe('internal.example,localhost,127.0.0.1,[::1]')
  })

  test('Given a NO_PROXY wildcard When building OAuth exclusions Then preserves its all-direct meaning', () => {
    expect(buildOAuthNoProxy('*')).toBe('*')
  })

  test('Given both NO_PROXY environment variable spellings When resolving exclusions Then prefers lowercase like Undici', () => {
    expect(readNoProxyEnvironment({
      NO_PROXY: 'uppercase.example',
      no_proxy: 'lowercase.example',
    })).toBe('lowercase.example')
  })

  test('Given an application proxy When running OAuth Then scopes the entire operation to that proxy', async () => {
    setEffectiveProxyUrlForTest(getEffectiveProxyUrl)
    getEffectiveProxyUrl.mockResolvedValue('http://127.0.0.1:7890')

    await expect(runWithOAuthProxyScope(async () => {
      expect(getPiRequestProxyDispatcher()).toBeDefined()
      return 'token'
    })).resolves.toBe('token')

    expect(getPiRequestProxyDispatcher()).toBeUndefined()
  })

  test('Given no configured proxy When running OAuth Then preserves direct networking while retaining loopback exclusions', async () => {
    setEffectiveProxyUrlForTest(getEffectiveProxyUrl)
    getEffectiveProxyUrl.mockResolvedValue(undefined)

    await expect(runWithOAuthProxyScope(async () => {
      expect(getPiRequestProxyDispatcher()).toBeUndefined()
      return 'token'
    })).resolves.toBe('token')
  })
})
