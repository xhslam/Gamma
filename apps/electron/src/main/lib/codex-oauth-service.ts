/**
 * ChatGPT (OpenAI Codex) OAuth 登录服务
 *
 * 复用 Pi AI 单个 Codex provider 内置的 OAuth 流程完成登录：
 * - 登录必须在主进程（Node 侧）执行——SDK 使用 Node crypto 生成 PKCE，并在
 *   本地 127.0.0.1:1455 起回调服务接收授权码，无法在渲染进程运行。
 * - 浏览器由本服务通过 shell.openExternal 打开；SDK 内部的回调服务负责接收
 *   redirect 并完成 code→token 交换，最终返回 { access, refresh, expires, accountId }。
 *
 * token 的加密存储与过期刷新由上层（channel-manager / pi-model-registry）负责，
 * 本服务只封装"跑一次登录流程""刷新一次 token"两个纯操作。
 */

import { shell } from 'electron'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import type { CodexOAuthCredentials, CodexOAuthDeviceCode, CodexOAuthLoginMethod } from '@gamma/shared'
import { runWithOAuthProxyScope } from './oauth-proxy-scope'

/** 只加载授权所需模块，避免在 Electron 主进程初始化 CLI/TUI 和平台工具依赖。 */
async function createCodexModels(credentials: CredentialStore) {
  const [{ createModels }, { openaiCodexProvider }] = await Promise.all([
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/providers/openai-codex'),
  ])
  const models = createModels({ credentials })
  models.setProvider(openaiCodexProvider())
  return models
}

/**
 * Pi AI 使用 CredentialStore 的结构契约。OAuth 凭据仍由 Gamma
 * channel-manager 加密持久化；这里使用内存 store，避免 Pi 写入自己的 ~/.pi 配置。
 */
function createEphemeralCredentialStore(initial?: Credential) {
  let credential = initial
  return {
    async read(): Promise<Credential | undefined> { return credential },
    async list(): Promise<readonly { providerId: string; type: Credential['type'] }[]> {
      return credential ? [{ providerId: 'openai-codex', type: credential.type }] : []
    },
    async modify(_providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
      credential = await fn(credential)
      return credential
    },
    async delete(): Promise<void> { credential = undefined },
  }
}

function normalizeCredentials(value: unknown): CodexOAuthCredentials {
  if (!value || typeof value !== 'object') throw new Error('Pi OAuth 未返回有效凭据')
  const credential = value as Partial<CodexOAuthCredentials>
  if (typeof credential.access !== 'string' || typeof credential.refresh !== 'string' || typeof credential.expires !== 'number') {
    throw new Error('Pi OAuth 返回的凭据缺少 access、refresh 或 expires')
  }
  return {
    access: credential.access,
    refresh: credential.refresh,
    expires: credential.expires,
    ...(typeof credential.accountId === 'string' && credential.accountId ? { accountId: credential.accountId } : {}),
  }
}

/** 进行中的登录流程的取消控制器（同一时刻只允许一个登录流程）。 */
let activeLoginAbort: AbortController | undefined

/** Pi OAuth 使用全局 fetch；登录和刷新均由 runWithOAuthProxyScope 绑定 Gamma 代理。 */

export interface CodexLoginCallbacks {
  /** SDK 生成授权 URL 后回调，用于（除自动开浏览器外）通知渲染层展示 URL。 */
  onAuthUrl?: (url: string) => void
  /** Pi 生成 device code 后回调，供 UI 展示、复制或交给另一台设备扫码。 */
  onDeviceCode?: (deviceCode: CodexOAuthDeviceCode) => void
  /** 进度消息回调。 */
  onProgress?: (message: string) => void
}

export interface CodexLoginOptions extends CodexLoginCallbacks {
  /** 默认系统浏览器；网络受限时可选择 RFC 8628 device-code 流程。 */
  method?: CodexOAuthLoginMethod
}

/**
 * 发起一次 ChatGPT (Codex) 浏览器 OAuth 登录。
 *
 * 成功返回规范化的 OAuth 凭据；用户取消或失败则抛错。
 * 登录期间自动用系统浏览器打开授权页，SDK 内部回调服务（:1455）接收授权码。
 */
export async function loginCodexOAuth(options?: CodexLoginOptions): Promise<CodexOAuthCredentials> {
  const method = options?.method ?? 'browser'

  // 取消上一个仍在进行的登录流程，避免 :1455 端口占用与并发回调。
  activeLoginAbort?.abort()
  const abort = new AbortController()
  activeLoginAbort = abort

  let browserError: Error | undefined
  const openAuthPage = (url: string): void => {
    void shell.openExternal(url).catch(() => {
      // 不把含 state/PKCE 的授权 URL 写入错误日志。
      browserError = new Error('无法打开系统浏览器，请检查系统默认浏览器设置，或改用设备码登录')
      abort.abort()
    })
  }

  try {
    return await runWithOAuthProxyScope(async () => {
      const runtime = await createCodexModels(createEphemeralCredentialStore())
      abort.signal.throwIfAborted()
      const credentials = await runtime.login('openai-codex', 'oauth', {
        signal: abort.signal,
        prompt: async (prompt) => {
          abort.signal.throwIfAborted()
          prompt.signal?.throwIfAborted()
          if (prompt.type === 'select') return method
          return new Promise<string>((_resolve, reject) => {
            prompt.signal?.addEventListener('abort', () => reject(new Error('登录已取消')), { once: true })
            abort.signal.addEventListener('abort', () => reject(new Error('登录已取消')), { once: true })
          })
        },
        notify: (event) => {
          if (event.type === 'auth_url') {
            options?.onAuthUrl?.(event.url)
            openAuthPage(event.url)
          } else if (event.type === 'device_code') {
            console.log(`[Codex OAuth] 请在浏览器中授权（设备码：${event.userCode}）`)
            options?.onDeviceCode?.({ userCode: event.userCode, verificationUri: event.verificationUri })
            openAuthPage(event.verificationUri)
          } else if (event.type === 'progress' || event.type === 'info') {
            console.log(`[Codex OAuth] ${event.message}`)
            options?.onProgress?.(event.message)
          }
        },
      })
      return normalizeCredentials(credentials)
    })
  } catch (error) {
    throw browserError ?? error
  } finally {
    if (activeLoginAbort === abort) {
      activeLoginAbort = undefined
    }
  }
}

/** 取消进行中的 Codex OAuth 登录流程（若有）。 */
export function cancelCodexOAuthLogin(): void {
  activeLoginAbort?.abort()
  activeLoginAbort = undefined
}

/**
 * 用 refresh token 刷新 Codex OAuth 凭据。
 *
 * 返回新的规范化凭据（含新的 expires）。SDK 在 refresh token 未轮换时会复用旧值。
 */
export async function refreshCodexOAuth(refreshToken: string): Promise<CodexOAuthCredentials> {
  return runWithOAuthProxyScope(async () => {
    const store = createEphemeralCredentialStore({
      type: 'oauth',
      access: '',
      refresh: refreshToken,
      expires: 0,
    })
    const runtime = await createCodexModels(store)
    // getAuth() 走 provider 的标准 refresh 流程，并通过 store 原子更新凭据。
    await runtime.getAuth('openai-codex')
    return normalizeCredentials(await store.read())
  })
}
