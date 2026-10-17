import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertLegacyCookiesComplete } from './legacy-cookie-inventory'
import type { LegacyCookieInventory } from './legacy-cookie-inventory'
import type { LegacyCookieProfile } from './legacy-credential-helper'

import { getElectronExecutablePath } from '../../test-utils/electron-executable'

const electronBinary = getElectronExecutablePath()
const inventoryModulePath = join(import.meta.dir, 'legacy-cookie-inventory.ts')
const partition = `proma-browser-${'a'.repeat(32)}`
const expected: LegacyCookieInventory = {
  profiles: [
    { partition: null, cookies: [{ domain: '.example.test', name: 'login', path: '/', encrypted: true, hasPlaintextValue: false }] },
    { partition, cookies: [{ domain: 'workspace.example.test', name: 'session', path: '/workspace', encrypted: false, hasPlaintextValue: true }] },
  ],
}

function exportedCookies(): LegacyCookieProfile[] {
  return [
    { partition: null, cookies: [{ domain: '.example.test', name: 'login', path: '/', value: 'decrypted-login', sameSite: 'lax' }] },
    { partition, cookies: [{ domain: 'workspace.example.test', name: 'session', path: '/workspace', value: 'original-token', sameSite: 'lax' }] },
  ]
}

test('Given 完整的旧 Cookie 库存 When 导出身份和解密值齐全 Then 校验成功', () => {
  expect(() => assertLegacyCookiesComplete(expected, exportedCookies())).not.toThrow()
})

test('Given 有旧登录 Cookie When 错误身份成功返回空数组 Then 校验拒绝而非把空结果当迁移成功', () => {
  const profiles = exportedCookies()
  profiles[0]!.cookies = []
  expect(() => assertLegacyCookiesComplete(expected, profiles)).toThrow('未完整解密')
})

test('Given 相同 Cookie 名称位于不同域名或路径 When 导出误匹配 Then 库存校验拒绝', () => {
  const wrongDomain = exportedCookies()
  wrongDomain[0]!.cookies[0]!.domain = 'other.example.test'
  expect(() => assertLegacyCookiesComplete(expected, wrongDomain)).toThrow('未完整解密')
  const wrongPath = exportedCookies()
  wrongPath[1]!.cookies[0]!.path = '/'
  expect(() => assertLegacyCookiesComplete(expected, wrongPath)).toThrow('未完整解密')
})

test('Given 加密库存或非空明文库存 When 导出值变为空 Then 保守停止并保留旧数据', () => {
  for (const index of [0, 1]) {
    const profiles = exportedCookies()
    profiles[index]!.cookies[0]!.value = ''
    expect(() => assertLegacyCookiesComplete(expected, profiles)).toThrow('未完整解密')
  }
})

test('Given 确实为空的 profile 或明文空 Cookie When 完整导出 Then 不凭空阻断', () => {
  expect(() => assertLegacyCookiesComplete({ profiles: [{ partition: null, cookies: [] }] }, [{ partition: null, cookies: [] }])).not.toThrow()
  expect(() => assertLegacyCookiesComplete({ profiles: [{ partition: null, cookies: [{ domain: 'empty.example.test', name: '', path: '/', encrypted: false, hasPlaintextValue: false }] }] }, [{ partition: null, cookies: [{ domain: 'empty.example.test', name: '', path: '/', value: '', sameSite: 'lax' }] }])).not.toThrow()
})

test('Given 旧 profile 库存 When 导出缺少分区、重复分区或重复 Cookie Then 校验拒绝', () => {
  expect(() => assertLegacyCookiesComplete(expected, exportedCookies().slice(0, 1))).toThrow('profile 库存不一致')
  const duplicateProfile = exportedCookies()
  duplicateProfile.push(duplicateProfile[0]!)
  expect(() => assertLegacyCookiesComplete(expected, duplicateProfile)).toThrow('导出结构无效')
  const duplicateCookie = exportedCookies()
  duplicateCookie[0]!.cookies.push(duplicateCookie[0]!.cookies[0]!)
  expect(() => assertLegacyCookiesComplete(expected, duplicateCookie)).toThrow('重复记录')
  const wrongPartition = exportedCookies()
  wrongPartition[1]!.partition = `proma-browser-${'b'.repeat(32)}`
  expect(() => assertLegacyCookiesComplete(expected, wrongPartition)).toThrow('缺少 profile')
})

async function verifyInventoryDatabase(scenario: string): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'gamma-cookie-inventory-test-'))
  const sourcePath = join(directory, 'verify-cookie-inventory.ts')
  const outputPath = join(directory, 'verify-cookie-inventory.mjs')
  writeFileSync(sourcePath, `
    import assert from 'node:assert/strict'
    import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    import { DatabaseSync } from 'node:sqlite'
    import { readLegacyCookieInventory } from ${JSON.stringify(inventoryModulePath)}

    const root = process.env.GAMMA_COOKIE_TEST_DIRECTORY
    const nowSeconds = 1_700_000_000
    const chromeNow = BigInt(nowSeconds) * 1_000_000n + 11_644_473_600_000_000n
    const partition = ${JSON.stringify(partition)}
    function database(directory, modern = true, network = false) {
      const parent = network ? join(directory, 'Network') : directory
      mkdirSync(parent, { recursive: true })
      const path = join(parent, 'Cookies')
      const db = new DatabaseSync(path)
      db.exec('CREATE TABLE cookies (host_key TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL, expires_utc INTEGER NOT NULL, is_persistent INTEGER NOT NULL, has_expires INTEGER NOT NULL' + (modern ? ', top_frame_site_key TEXT NOT NULL' : '') + ')')
      const add = (name, options = {}) => {
        const row = [options.domain ?? '.example.test', name, options.path ?? '/', options.value ?? '', options.encrypted === false ? Buffer.alloc(0) : Buffer.from('v10-fixture'), options.expiry ?? chromeNow + 3_600_000_000n, options.persistent === false ? 0 : 1, options.persistent === false ? 0 : 1]
        if (modern) row.push(options.site ?? '')
        db.prepare('INSERT INTO cookies VALUES (' + row.map(() => '?').join(',') + ')').run(...row)
      }
      return { db, path, add }
    }

    if (process.env.GAMMA_COOKIE_TEST_SCENARIO === 'inventory') {
      const profile = join(root, 'snapshot')
      const main = database(profile, false)
      main.add('login')
      main.add('plain', { encrypted: false, value: 'plaintext-token' })
      main.add('', { domain: 'empty.example.test', encrypted: false })
      main.add('expired', { expiry: chromeNow - 1n })
      main.add('exactly-expired', { expiry: chromeNow })
      main.add('session', { persistent: false })
      main.db.close()
      const workspace = database(join(profile, 'Partitions', partition), true, true)
      workspace.add('workspace-login', { domain: 'workspace.example.test', path: '/workspace' })
      workspace.db.close()
      mkdirSync(join(profile, 'Partitions', 'unrelated-browser'), { recursive: true })
      const beforeDefault = readFileSync(main.path)
      const beforeWorkspace = readFileSync(workspace.path)
      const inventory = readLegacyCookieInventory(profile, nowSeconds)
      assert.deepEqual(inventory, { profiles: [
        { partition: null, cookies: [
          { domain: '.example.test', name: 'login', path: '/', encrypted: true, hasPlaintextValue: false },
          { domain: '.example.test', name: 'plain', path: '/', encrypted: false, hasPlaintextValue: true },
          { domain: 'empty.example.test', name: '', path: '/', encrypted: false, hasPlaintextValue: false }
        ] },
        { partition, cookies: [{ domain: 'workspace.example.test', name: 'workspace-login', path: '/workspace', encrypted: true, hasPlaintextValue: false }] }
      ] })
      assert.equal(JSON.stringify(inventory).includes('plaintext-token'), false)
      assert.deepEqual(readFileSync(main.path), beforeDefault)
      assert.deepEqual(readFileSync(workspace.path), beforeWorkspace)
      assert.deepEqual(readdirSync(profile).sort(), ['Cookies', 'Partitions'])
      const empty = join(root, 'empty')
      mkdirSync(empty)
      assert.deepEqual(readLegacyCookieInventory(empty, nowSeconds), { profiles: [{ partition: null, cookies: [] }] })
    } else if (process.env.GAMMA_COOKIE_TEST_SCENARIO === 'chips') {
      const profile = join(root, 'snapshot')
      const main = database(profile)
      main.add('expired-chips', { site: 'https://old.test', expiry: chromeNow })
      main.add('session-chips', { site: 'https://session.test', persistent: false })
      main.db.close()
      assert.deepEqual(readLegacyCookieInventory(profile, nowSeconds), { profiles: [{ partition: null, cookies: [] }] })
      const workspace = database(join(profile, 'Partitions', partition))
      workspace.add('partitioned-login', { site: 'https://top-frame.test' })
      workspace.db.close()
      const before = readFileSync(workspace.path)
      assert.throws(() => readLegacyCookieInventory(profile, nowSeconds), /分区 Cookie/)
      assert.deepEqual(readFileSync(workspace.path), before)
    } else {
      const duplicated = join(root, 'duplicate')
      const duplicateDb = database(duplicated)
      duplicateDb.add('login')
      duplicateDb.add('login')
      duplicateDb.db.close()
      assert.throws(() => readLegacyCookieInventory(duplicated, nowSeconds), /唯一区分/)
      const conflicted = join(root, 'two-databases')
      database(conflicted).db.close()
      database(conflicted, true, true).db.close()
      assert.throws(() => readLegacyCookieInventory(conflicted, nowSeconds), /多个 Cookie 数据库/)
      const linked = join(root, 'linked')
      mkdirSync(linked)
      const outside = join(root, 'outside.txt')
      writeFileSync(outside, 'outside-sentinel')
      symlinkSync(outside, join(linked, 'Cookies'))
      assert.throws(() => readLegacyCookieInventory(linked, nowSeconds), /不是独立文件/)
      assert.equal(readFileSync(outside, 'utf8'), 'outside-sentinel')
      const dangling = join(root, 'dangling')
      mkdirSync(dangling)
      symlinkSync(join(root, 'missing-database'), join(dangling, 'Cookies'))
      assert.throws(() => readLegacyCookieInventory(dangling, nowSeconds), /不是独立文件/)
      const malformed = join(root, 'malformed')
      mkdirSync(malformed)
      const invalidDb = new DatabaseSync(join(malformed, 'Cookies'))
      invalidDb.exec('CREATE TABLE cookies (name TEXT)')
      invalidDb.close()
      assert.throws(() => readLegacyCookieInventory(malformed, nowSeconds), /结构不受支持/)
      assert.throws(() => readLegacyCookieInventory(malformed, Infinity), /时间无效/)
    }
  `)
  try {
    const built = await Bun.build({ entrypoints: [sourcePath], target: 'node', format: 'esm', external: ['node:sqlite'] })
    expect(built.success, built.logs.map((log) => log.message).join('\n')).toBe(true)
    const script = built.outputs[0]
    if (!script) throw new Error('未生成 Cookie 库存验证脚本')
    await Bun.write(outputPath, script)
    const result = spawnSync(electronBinary, [outputPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', GAMMA_COOKIE_TEST_DIRECTORY: directory, GAMMA_COOKIE_TEST_SCENARIO: scenario },
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + '\n' + result.stderr).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('Given 默认与受管分区 Cookie SQLite When 只读库存 Then Chrome epoch、过期/session 筛选和旧 schema 正确且文件未改动', async () => {
  await verifyInventoryDatabase('inventory')
})

test('Given 活跃 CHIPS 登录 Cookie When 库存检查 Then 阻止当前 API 的有损迁移而忽略过期/session 行', async () => {
  await verifyInventoryDatabase('chips')
})

test('Given 模糊库、重复身份、链接或未知 schema When 库存检查 Then 明确停止并保留源文件', async () => {
  await verifyInventoryDatabase('boundaries')
})
