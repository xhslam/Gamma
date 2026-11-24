import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { Cookie, CookiesSetDetails } from 'electron'
import {
  importLegacyCookieProfiles,
  legacyCookieSetDetails,
  setSessionForTest,
} from './legacy-credential-helper'

let values: Cookie[] = []
let substituteParent = false
let evictFirst = false
let flushed = false
let requireSecureOrigin = false
const cookies = {
  set: async (details: CookiesSetDetails) => {
    if (requireSecureOrigin && details.url.startsWith('http:')) throw new Error('EXCLUDE_OVERWRITE_SECURE')
    const domain = details.domain ?? new URL(details.url).hostname
    const cookie: Cookie = {
      name: details.name ?? '', value: details.value ?? '', domain: substituteParent ? '.example.test' : domain,
      hostOnly: substituteParent ? false : details.domain === undefined,
      path: details.path ?? '/', secure: details.secure, httpOnly: details.httpOnly,
      sameSite: (details.sameSite ?? 'unspecified') as Cookie['sameSite'],
      session: details.expirationDate === undefined, expirationDate: details.expirationDate,
    }
    if (evictFirst) values = []
    values.push(cookie)
  },
  get: async () => values,
  flushStore: async () => { flushed = true },
}
const cookie: Cookie = { name: 'login', value: 'fixture-secret', domain: 'child.example.test', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: Date.now() / 1000 + 3600 }
beforeEach(() => {
  values = []; substituteParent = false; evictFirst = false; flushed = false; requireSecureOrigin = false
  setSessionForTest({ defaultSession: { cookies }, fromPartition: () => ({ cookies }) })
})
afterEach(() => {
  setSessionForTest(null)
})

test('Given hostOnly 持久 Cookie When 迁移 Then 保留域、权限、SameSite 和有效期并验证落盘库存', async () => {
  expect(legacyCookieSetDetails(cookie).domain).toBeUndefined()
  await importLegacyCookieProfiles([{ partition: null, cookies: [cookie] }])
  expect(flushed).toBe(true)
  expect(values).toEqual([cookie])
})

test('Given 同名同值父域 Cookie When 子域 Cookie 未写入 Then 域名校验拒绝错误成功', async () => {
  substituteParent = true
  await expect(importLegacyCookieProfiles([{ partition: null, cookies: [cookie] }])).rejects.toThrow('校验失败')
  expect(flushed).toBe(false)
})

test('Given 后续 Cookie 写入挤掉先前记录 When 最终落盘检查 Then 拒绝不完整库存', async () => {
  evictFirst = true
  await expect(importLegacyCookieProfiles([{ partition: null, cookies: [cookie, { ...cookie, name: 'second' }] }])).rejects.toThrow('落盘后库存不完整')
  expect(flushed).toBe(true)
})

test('Given 同名 Cookie 与 Secure 路径重叠 When 从 HTTPS 重试 Then 保留两条记录各自的 Secure 属性', async () => {
  requireSecureOrigin = true
  const insecure = { ...cookie, path: '/nested', secure: false }
  await importLegacyCookieProfiles([{ partition: null, cookies: [cookie, insecure] }])
  expect(values).toEqual([cookie, insecure])
})

test('Given 目标已有同一身份的 Secure Cookie When HTTP 写入被拒绝 Then 不覆盖该记录', async () => {
  requireSecureOrigin = true
  values = [cookie]
  await expect(importLegacyCookieProfiles([{ partition: null, cookies: [{ ...cookie, secure: false }] }])).rejects.toThrow('EXCLUDE_OVERWRITE_SECURE')
  expect(values).toEqual([cookie])
})

test('Given 已过期 Cookie 或非法 partition When 迁移 Then 忽略过期记录并拒绝未知分区', async () => {
  await importLegacyCookieProfiles([{ partition: null, cookies: [{ ...cookie, expirationDate: 1 }] }])
  expect(values).toEqual([])
  await expect(importLegacyCookieProfiles([{ partition: 'untrusted-partition', cookies: [] }])).rejects.toThrow('partition 非法')
})
