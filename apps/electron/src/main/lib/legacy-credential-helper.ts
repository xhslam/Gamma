/**
 * 旧 Electron 身份的隔离迁移进程。
 * 明文只经匿名管道进入 Gamma 进程，不写文件、不进入日志。
 */
import { app, safeStorage, session } from 'electron'
import type { Cookie, CookiesSetDetails, Session } from 'electron'

interface LegacyCookieSession {
  cookies: Pick<Session['cookies'], 'get' | 'set' | 'flushStore'>
}
interface LegacyCookieSessionSource {
  defaultSession: LegacyCookieSession
  fromPartition(partition: string): LegacyCookieSession
}
let testSession: LegacyCookieSessionSource | null = null

/** 测试只替换迁移目标的Cookie读写，不替换源profile的离线网络隔离。 */
export function setSessionForTest(mockSession: LegacyCookieSessionSource | null): void {
  testSession = mockSession
}

function getSession(): LegacyCookieSessionSource {
  return testSession ?? session
}

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { copyLegacyProfile } from './legacy-brand-migration'

export const LEGACY_HELPER_ARGUMENT = '--gamma-legacy-migration-helper'
const PIPE_PREFIX = 'GAMMA_LEGACY_PIPE:'
const HELPER_TIMEOUT_MS = 30_000
const MAX_PIPE_BYTES = 64 * 1024 * 1024

interface LegacyHelperOptions {
  identity: string
  profileCopy: string
  sourceProfile?: string
  guard: boolean
}

interface HelperRequest {
  id: number
  operation: 'decrypt' | 'cookies'
  values?: string[]
}

interface HelperResponse {
  type: 'ready' | 'response' | 'failed'
  id?: number
  values?: Array<string | null>
  cookieProfiles?: LegacyCookieProfile[]
  reason?: 'busy' | 'initialization' | 'request'
}

export interface LegacyCookieProfile {
  partition: string | null
  cookies: Cookie[]
}

export interface LegacyHelperClient {
  profileCopy: string
  decrypt(values: string[]): Promise<Array<string | null>>
  getCookies(): Promise<LegacyCookieProfile[]>
  stop(): Promise<void>
}

function writeResponse(response: HelperResponse): void {
  process.stdout.write(`${PIPE_PREFIX}${JSON.stringify(response)}\n`)
}

function offlineSession(browserSession: Session): void {
  browserSession.enableNetworkEmulation({ offline: true })
  browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
}

async function exportCopiedCookies(): Promise<LegacyCookieProfile[]> {
  const profiles: LegacyCookieProfile[] = []
  offlineSession(session.defaultSession)
  profiles.push({ partition: null, cookies: await session.defaultSession.cookies.get({}) })
  const partitions = join(app.getPath('userData'), 'Partitions')
  if (!existsSync(partitions)) return profiles
  for (const entry of readdirSync(partitions, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^proma-browser-[a-f\d]{32}$/.test(entry.name)) continue
    const browserSession = session.fromPartition(`persist:${entry.name}`)
    offlineSession(browserSession)
    profiles.push({ partition: entry.name, cookies: await browserSession.cookies.get({}) })
  }
  return profiles
}

/** 返回 true 时，调用方不能继续载入正常应用服务。 */
export function runLegacyCredentialHelper(): boolean {
  const argumentIndex = process.argv.indexOf(LEGACY_HELPER_ARGUMENT)
  if (argumentIndex === -1) return false
  try {
    const options = JSON.parse(process.argv[argumentIndex + 1] ?? '') as LegacyHelperOptions
    if (!options || typeof options !== 'object' || !/^(?:@proma\/electron|Proma(?:-[a-zA-Z\d_-]+)?)$/.test(options.identity)) throw new Error('invalid identity')
    const temporaryRoot = resolve(app.getPath('temp')) + sep
    if (typeof options.profileCopy !== 'string' || !resolve(options.profileCopy).startsWith(temporaryRoot) || !basename(options.profileCopy).startsWith('gamma-legacy-')) throw new Error('invalid temporary profile')
    if (lstatSync(options.profileCopy).isSymbolicLink()) throw new Error('invalid temporary profile')
    app.setName(options.identity)
    app.disableHardwareAcceleration()
    if (options.sourceProfile) {
      const source = resolve(options.sourceProfile)
      const sourceIsLegacyProfile = source.startsWith(resolve(app.getPath('appData')) + sep) && /^(?:@proma\/electron(?:-dev(?:-[a-zA-Z\d_-]+)?)?|Proma)$/.test(source.slice(resolve(app.getPath('appData')).length + 1))
      const sourceIsHelperCopy = source.startsWith(temporaryRoot) && basename(source).startsWith('gamma-legacy-')
      if ((!sourceIsLegacyProfile && !sourceIsHelperCopy) || lstatSync(source).isSymbolicLink()) throw new Error('invalid source profile')
      if (options.guard) {
        // 锁住旧目录，但所有 Chromium/OSCrypt 初始化都发生在随后的副本中。
        app.setPath('userData', source)
        if (!app.requestSingleInstanceLock({ gammaBrandMigration: true })) {
          writeResponse({ type: 'failed', reason: 'busy' })
          app.exit(1)
          return true
        }
      }
      copyLegacyProfile(source, options.profileCopy)
    }
    app.setPath('userData', options.profileCopy)
    app.setPath('sessionData', options.profileCopy)
    let input = ''
    let queue = Promise.resolve()
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: string) => {
      input += chunk
      if (Buffer.byteLength(input) > MAX_PIPE_BYTES) { app.exit(1); return }
      let newline: number
      while ((newline = input.indexOf('\n')) !== -1) {
        const line = input.slice(0, newline)
        input = input.slice(newline + 1)
        queue = queue.then(async () => {
          let request: HelperRequest | undefined
          try {
            request = JSON.parse(line) as HelperRequest
            if (!Number.isSafeInteger(request.id)) throw new Error('invalid request')
            if (request.operation === 'decrypt' && Array.isArray(request.values) && request.values.every((value) => typeof value === 'string')) {
              const values = request.values.map((value) => {
                try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : null }
                catch { return null }
              })
              writeResponse({ type: 'response', id: request.id, values })
            } else if (request.operation === 'cookies') writeResponse({ type: 'response', id: request.id, cookieProfiles: await exportCopiedCookies() })
            else throw new Error('unsupported request')
          } catch { writeResponse({ type: 'failed', id: request?.id, reason: 'request' }) }
        })
      }
    })
    process.stdin.on('end', () => { void queue.finally(() => app.exit(0)) })
    process.stdin.on('error', () => app.exit(1))
    process.stdout.on('error', () => app.exit(1))
    app.whenReady().then(() => writeResponse({ type: 'ready' })).catch(() => { writeResponse({ type: 'failed', reason: 'initialization' }); app.exit(1) })
  } catch { writeResponse({ type: 'failed', reason: 'initialization' }); app.exit(1) }
  return true
}

export async function startLegacyCredentialHelper(identity: string, sourceProfile?: string, guard = true): Promise<LegacyHelperClient> {
  const profileCopy = mkdtempSync(join(app.getPath('temp'), 'gamma-legacy-'))
  const options: LegacyHelperOptions = { identity, profileCopy, ...(sourceProfile ? { sourceProfile } : {}), guard }
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), LEGACY_HELPER_ARGUMENT, JSON.stringify(options)]
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, args, { stdio: 'pipe', windowsHide: true })
  const pending = new Map<number, { resolve: (response: HelperResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let nextId = 0
  let output = ''
  let stopped = false
  let readyResolve: () => void
  let readyReject: (error: Error) => void
  const ready = new Promise<void>((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady })
  const rejectAll = (message: string): void => {
    const error = new Error(message)
    readyReject(error)
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
  }
  const exited = new Promise<void>((resolveExit) => child.once('close', () => { resolveExit(); if (!stopped) rejectAll('旧凭据迁移进程提前退出，原数据已保留。') }))
  child.once('error', () => rejectAll('无法启动旧凭据迁移进程，原数据已保留。'))
  child.stdin.on('error', () => { if (!stopped) rejectAll('旧凭据迁移管道中断，原数据已保留。') })
  child.stderr.resume() // Chromium 诊断可能包含网页地址，迁移过程不转发或记录。
  child.stdout.setEncoding('utf-8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
    if (Buffer.byteLength(output) > MAX_PIPE_BYTES) { rejectAll('旧凭据迁移响应超出上限。'); child.kill(); return }
    let newline: number
    while ((newline = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, newline)
      output = output.slice(newline + 1)
      if (!line.startsWith(PIPE_PREFIX)) continue
      try {
        const response = JSON.parse(line.slice(PIPE_PREFIX.length)) as HelperResponse
        if (response.type === 'ready') readyResolve()
        else if (response.type === 'failed' && response.id === undefined) rejectAll(response.reason === 'busy' ? 'Proma 仍在运行。请退出旧应用后重新启动 Gamma；旧数据没有被复制或改写。' : '旧凭据迁移进程初始化失败，原数据已保留。')
        else if (response.id !== undefined) {
          const item = pending.get(response.id)
          if (!item) continue
          clearTimeout(item.timer)
          pending.delete(response.id)
          if (response.type === 'failed') item.reject(new Error('旧凭据或浏览器登录状态读取失败，原数据已保留。'))
          else item.resolve(response)
        }
      } catch { rejectAll('旧凭据迁移响应无效。'); child.kill() }
    }
  })
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), 2_000)
    await exited
    clearTimeout(timer)
    rmSync(profileCopy, { recursive: true, force: true })
  }
  const timer = setTimeout(() => { rejectAll('旧凭据迁移进程初始化超时。'); child.kill() }, HELPER_TIMEOUT_MS)
  try { await ready } catch (error) { await stop(); throw error } finally { clearTimeout(timer) }
  const request = (operation: HelperRequest['operation'], values?: string[]): Promise<HelperResponse> => {
    const id = ++nextId
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => { pending.delete(id); rejectRequest(new Error('旧数据迁移请求超时，原数据已保留。')) }, HELPER_TIMEOUT_MS)
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
      child.stdin.write(`${JSON.stringify({ id, operation, ...(values ? { values } : {}) })}\n`)
    })
  }
  return {
    profileCopy,
    decrypt: async (values) => {
      const response = await request('decrypt', values)
      if (!Array.isArray(response.values) || response.values.length !== values.length || !response.values.every((value) => typeof value === 'string' || value === null)) throw new Error('旧凭据迁移响应数量不一致。')
      return response.values
    },
    getCookies: async () => {
      const response = await request('cookies')
      if (!Array.isArray(response.cookieProfiles)) throw new Error('浏览器登录状态迁移响应无效。')
      return response.cookieProfiles
    },
    stop,
  }
}

export function legacyCookieSetDetails(cookie: Cookie): CookiesSetDetails {
  if (!cookie.domain) throw new Error('旧浏览器 Cookie 缺少域名，迁移已停止。')
  const hostname = cookie.domain.replace(/^\./, '')
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${hostname}${cookie.path || '/'}`,
    name: cookie.name,
    value: cookie.value,
    ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    ...(!cookie.session && cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}),
  }
}

/** Cookie 通过 Electron API 重写，让 Gamma 的 OSCrypt 使用新身份加密。 */
export async function importLegacyCookieProfiles(profiles: readonly LegacyCookieProfile[]): Promise<void> {
  for (const profile of profiles) {
    if (profile.partition !== null && !/^proma-browser-[a-f\d]{32}$/.test(profile.partition)) throw new Error('旧浏览器 partition 非法，迁移已停止。')
    const browserSession = profile.partition === null ? getSession().defaultSession : getSession().fromPartition(`persist:gamma-browser-${profile.partition.slice('proma-browser-'.length)}`)
    const expected: Cookie[] = []
    const matches = (value: Cookie, cookie: Cookie): boolean => value.name === cookie.name && value.value === cookie.value && value.domain === cookie.domain &&
      value.path === (cookie.path || '/') && Boolean(value.hostOnly) === Boolean(cookie.hostOnly) &&
      Boolean(value.secure) === Boolean(cookie.secure) && Boolean(value.httpOnly) === Boolean(cookie.httpOnly) &&
      (value.sameSite ?? 'unspecified') === (cookie.sameSite ?? 'unspecified') &&
      Boolean(value.session) === Boolean(cookie.session) &&
      (cookie.expirationDate === undefined || value.expirationDate !== undefined && Math.abs(value.expirationDate - cookie.expirationDate) < 1)
    for (const cookie of profile.cookies) {
      if (cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000) continue
      const details = legacyCookieSetDetails(cookie)
      await browserSession.cookies.set(details)
      const imported = await browserSession.cookies.get({ url: details.url, name: cookie.name })
      if (!imported.some((value) => matches(value, cookie))) throw new Error('浏览器登录状态迁移校验失败，旧数据已保留。')
      expected.push(cookie)
    }
    await browserSession.cookies.flushStore()
    const stored = await browserSession.cookies.get({})
    if (!expected.every((cookie) => stored.some((value) => matches(value, cookie)))) throw new Error('浏览器登录状态落盘后库存不完整，迁移已停止；旧数据已保留。')
  }
}
