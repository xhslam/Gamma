/**
 * 在 Chromium 接触副本前记录 Cookie 库存，避免错误的 OSCrypt 身份静默丢弃旧登录状态。
 * 仅读取未过期的持久 Cookie；库存不含明文或密文值。
 */
import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LegacyCookieProfile } from './legacy-credential-helper'

const CHROME_EPOCH_OFFSET_MICROSECONDS = 11_644_473_600_000_000n
const LEGACY_BROWSER_PARTITION = /^proma-browser-[a-f\d]{32}$/

interface CookieInventoryStatement {
  all(...parameters: Array<string | bigint>): unknown[]
}

interface CookieInventoryDatabase {
  prepare(sql: string): CookieInventoryStatement
  close(): void
}

interface CookieInventorySqliteModule {
  DatabaseSync: new (path: string, options: { readOnly: true }) => CookieInventoryDatabase
}

interface CookieInventoryColumn {
  name: string
}

interface CookieInventoryRow {
  host_key: string
  name: string
  path: string
  plaintext_length: number
  encrypted_length: number
  top_frame_site_key: string
}

export interface LegacyCookieInventoryEntry {
  domain: string
  name: string
  path: string
  encrypted: boolean
  hasPlaintextValue: boolean
}

export interface LegacyCookieInventoryProfile {
  partition: string | null
  cookies: LegacyCookieInventoryEntry[]
}

export interface LegacyCookieInventory {
  profiles: LegacyCookieInventoryProfile[]
}

function assertPlainDirectory(directory: string): void {
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('旧浏览器 Cookie 目录不是独立目录，迁移已停止；旧数据已保留。')
}

function hasPath(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined
}

function cookieIdentity(domain: string, name: string, path: string): string {
  return JSON.stringify([domain, name, path])
}

function readProfileInventory(directory: string, partition: string | null, chromeNow: bigint): LegacyCookieInventoryProfile {
  assertPlainDirectory(directory)
  const network = join(directory, 'Network')
  if (hasPath(network)) assertPlainDirectory(network)
  const databases = [join(directory, 'Cookies'), join(network, 'Cookies')].filter(hasPath)
  if (databases.length > 1) throw new Error('旧浏览器同时存在多个 Cookie 数据库，无法确定正在使用的库存，迁移已停止；旧数据已保留。')
  const databasePath = databases[0]
  if (!databasePath) return { partition, cookies: [] }
  const stat = lstatSync(databasePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('旧浏览器 Cookie 数据库不是独立文件，迁移已停止；旧数据已保留。')
  const { DatabaseSync } = require('node:sqlite') as CookieInventorySqliteModule
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const columns = new Set((database.prepare('PRAGMA table_info(cookies)').all() as CookieInventoryColumn[]).map((column) => column.name))
    if (!['host_key', 'name', 'path', 'value', 'encrypted_value', 'expires_utc', 'is_persistent', 'has_expires'].every((name) => columns.has(name))) {
      throw new Error('旧浏览器 Cookie 数据库结构不受支持，迁移已停止；旧数据已保留。')
    }
    const partitionColumn = columns.has('top_frame_site_key') ? 'top_frame_site_key' : "'' AS top_frame_site_key"
    const rows = database.prepare(`
      SELECT host_key, name, path, length(value) AS plaintext_length, length(encrypted_value) AS encrypted_length, ${partitionColumn}
      FROM cookies WHERE is_persistent = 1 AND has_expires = 1 AND expires_utc > ?
    `).all(chromeNow) as CookieInventoryRow[]
    const cookies: LegacyCookieInventoryEntry[] = []
    const identities = new Set<string>()
    for (const row of rows) {
      if (typeof row.top_frame_site_key !== 'string' || row.top_frame_site_key !== '') {
        // 当前 Electron cookies API 无 partitionKey，不能把 CHIPS 降为普通 Cookie。
        throw new Error('旧浏览器含当前迁移 API 无法完整保留的分区 Cookie，迁移已停止；旧数据已保留。')
      }
      if (typeof row.host_key !== 'string' || !row.host_key || typeof row.name !== 'string' || typeof row.path !== 'string' || !row.path.startsWith('/') || !Number.isSafeInteger(row.plaintext_length) || row.plaintext_length < 0 || !Number.isSafeInteger(row.encrypted_length) || row.encrypted_length < 0) {
        throw new Error('旧浏览器 Cookie 库存含无效记录，迁移已停止；旧数据已保留。')
      }
      const identity = cookieIdentity(row.host_key, row.name, row.path)
      if (identities.has(identity)) throw new Error('旧浏览器含迁移 API 无法唯一区分的 Cookie，迁移已停止；旧数据已保留。')
      identities.add(identity)
      cookies.push({ domain: row.host_key, name: row.name, path: row.path, encrypted: row.encrypted_length > 0, hasPlaintextValue: row.plaintext_length > 0 })
    }
    return { partition, cookies }
  } finally {
    database.close()
  }
}

/** 必须传入从旧锁保护下取得、尚未由 Chromium 打开的完整快照。 */
export function readLegacyCookieInventory(profileSnapshot: string, nowSeconds = Date.now() / 1000): LegacyCookieInventory {
  if (!Number.isFinite(nowSeconds) || !Number.isSafeInteger(Math.floor(nowSeconds * 1_000_000))) throw new Error('Cookie 库存校验时间无效。')
  assertPlainDirectory(profileSnapshot)
  const chromeNow = BigInt(Math.floor(nowSeconds * 1_000_000)) + CHROME_EPOCH_OFFSET_MICROSECONDS
  const profiles = [readProfileInventory(profileSnapshot, null, chromeNow)]
  const partitions = join(profileSnapshot, 'Partitions')
  if (hasPath(partitions)) {
    assertPlainDirectory(partitions)
    for (const entry of readdirSync(partitions, { withFileTypes: true })) {
      if (!LEGACY_BROWSER_PARTITION.test(entry.name)) continue
      const directory = join(partitions, entry.name)
      assertPlainDirectory(directory)
      profiles.push(readProfileInventory(directory, entry.name, chromeNow))
    }
  }
  return { profiles }
}

/**
 * 正常完成 cookies.get 不代表成功解密；丢行、重复和空的加密结果都拒绝该身份。
 * 无法从库存判断加密空值是否原本为空，因此保守停止，避免误认错误身份。
 */
export function assertLegacyCookiesComplete(expected: LegacyCookieInventory, profiles: readonly LegacyCookieProfile[]): void {
  const exported = new Map<string | null, LegacyCookieProfile>()
  for (const profile of profiles) {
    if (!profile || (profile.partition !== null && (typeof profile.partition !== 'string' || !LEGACY_BROWSER_PARTITION.test(profile.partition))) || !Array.isArray(profile.cookies) || exported.has(profile.partition)) {
      throw new Error('旧浏览器 Cookie 导出结构无效，迁移已停止；旧数据已保留。')
    }
    exported.set(profile.partition, profile)
  }
  if (exported.size !== expected.profiles.length) throw new Error('旧浏览器 Cookie 导出的 profile 库存不一致，迁移已停止；旧数据已保留。')
  for (const profile of expected.profiles) {
    const actual = exported.get(profile.partition)
    if (!actual) throw new Error('旧浏览器 Cookie 导出缺少 profile，迁移已停止；旧数据已保留。')
    const values = new Map<string, string>()
    for (const cookie of actual.cookies) {
      if (!cookie || typeof cookie.domain !== 'string' || !cookie.domain || typeof cookie.name !== 'string' || typeof cookie.path !== 'string' || !cookie.path.startsWith('/') || typeof cookie.value !== 'string') {
        throw new Error('旧浏览器 Cookie 导出含无效记录，迁移已停止；旧数据已保留。')
      }
      const identity = cookieIdentity(cookie.domain, cookie.name, cookie.path)
      if (values.has(identity)) throw new Error('旧浏览器 Cookie 导出含重复记录，迁移已停止；旧数据已保留。')
      values.set(identity, cookie.value)
    }
    for (const cookie of profile.cookies) {
      const value = values.get(cookieIdentity(cookie.domain, cookie.name, cookie.path))
      if (value === undefined || (cookie.encrypted || cookie.hasPlaintextValue) && !value) {
        throw new Error('旧浏览器 Cookie 未完整解密，迁移已停止；旧数据已保留。')
      }
    }
  }
}
