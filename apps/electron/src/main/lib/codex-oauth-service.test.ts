import { describe, expect, test } from 'bun:test'

// 每个场景在独立进程加载真实 Pi provider，避免 Electron/代理 mock 污染其他测试。
const serviceUrl = new URL('./codex-oauth-service.ts', import.meta.url).href

async function runScenario(scenario: string): Promise<void> {
  const script = `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    // 模拟 Windows 源码编译环境中 CLI/TUI 依赖无法初始化；授权不应触及它。
    mock.module('@earendil-works/pi-coding-agent', () => { throw new Error('CLI unavailable') })
    let openPage = async (_url) => {}
    mock.module('electron', () => ({ shell: { openExternal: (url) => openPage(url) } }))
    let scopeCalls = 0
    mock.module(${JSON.stringify(new URL('./oauth-proxy-scope.ts', import.meta.url).href)}, () => ({
      runWithOAuthProxyScope: async (fn) => { scopeCalls++; return fn() },
    }))
    const { loginCodexOAuth, cancelCodexOAuthLogin, refreshCodexOAuth } = await import(${JSON.stringify(serviceUrl)})
    const access = 'header.' + btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })) + '.signature'
    const networkFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      const address = String(url)
      if (address.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'test-device', user_code: 'TEST-CODE', interval: 0 })
      if (address.endsWith('/deviceauth/token')) return Response.json({ authorization_code: 'test-code', code_verifier: 'test-verifier' })
      if (address.endsWith('/oauth/token')) return Response.json({ access_token: access, refresh_token: 'refreshed-token', expires_in: 3600 })
      throw new Error('Unexpected network request: ' + address)
    }
    ${scenario}
    assert.ok(scopeCalls > 0, '登录和刷新必须保留代理 scope')
  `
  const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 10_000)
  try {
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(stderr).toBe('')
    expect(code).toBe(0)
  } finally {
    clearTimeout(timer)
  }
}

describe('ChatGPT OAuth 独立授权', () => {
  test('Given CLI 依赖不可用 When 浏览器回调成功 Then 仍可登录并返回凭据', async () => {
    await runScenario(`
      openPage = async (url) => {
        const state = new URL(url).searchParams.get('state')
        const response = await networkFetch('http://127.0.0.1:1455/auth/callback?code=test-code&state=' + state)
        assert.equal(response.status, 200)
      }
      const credentials = await loginCodexOAuth()
      assert.equal(credentials.accountId, 'test-account')
      assert.equal(credentials.refresh, 'refreshed-token')
    `)
  })

  test('Given 设备码授权 When 授权完成 Then 通知设备码并返回凭据', async () => {
    await runScenario(`
      let deviceCode
      const credentials = await loginCodexOAuth({ method: 'device_code', onDeviceCode: (code) => { deviceCode = code } })
      assert.equal(deviceCode.userCode, 'TEST-CODE')
      assert.equal(credentials.accountId, 'test-account')
    `)
  })

  test('Given 系统浏览器启动失败 When 登录 Then 结束等待并返回可操作错误', async () => {
    await runScenario(`
      openPage = async () => { throw new Error('No default browser') }
      await assert.rejects(loginCodexOAuth(), /无法打开系统浏览器/)
    `)
  })

  test('Given 登录模块仍在加载 When 用户取消 Then 不再启动浏览器', async () => {
    await runScenario(`
      let opened = false
      openPage = async () => { opened = true }
      const pending = loginCodexOAuth()
      cancelCodexOAuthLogin()
      await assert.rejects(pending)
      assert.equal(opened, false)
    `)
  })

  test('Given 过期凭据 When 刷新 Then 使用单个 provider 返回轮换凭据', async () => {
    await runScenario(`
      const credentials = await refreshCodexOAuth('old-refresh')
      assert.equal(credentials.refresh, 'refreshed-token')
      assert.equal(credentials.access, access)
      assert.equal(credentials.accountId, 'test-account')
    `)
  })
})
