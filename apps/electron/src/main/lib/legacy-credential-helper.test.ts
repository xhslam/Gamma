import { beforeEach, expect, mock, test } from 'bun:test'
import type { Cookie } from 'electron'

let values: Cookie[] = []
let substituteParent = false
let evictFirst = false
let flushed = false
const cookies = {
  set: async (details: { name: string; value?: string; domain?: string; url: string; path?: string; secure?: boolean; httpOnly?: boolean; sameSite?: string; expirationDate?: number }) => {
    const domain = details.domain ?? new URL(details.url).hostname
    const cookie: Cookie = {
      name: details.name, value: details.value ?? '', domain: substituteParent ? '.example.test' : domain,
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
mock.module('electron', () => ({ app: {}, safeStorage: {}, session: { defaultSession: { cookies }, fromPartition: () => ({ cookies }) } }))
const { importLegacyCookieProfiles, legacyCookieSetDetails } = await import('./legacy-credential-helper')
const cookie: Cookie = { name: 'login', value: 'fixture-secret', domain: 'child.example.test', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: Date.now() / 1000 + 3600 }
beforeEach(() => { values = []; substituteParent = false; evictFirst = false; flushed = false })

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

test('Given 已过期 Cookie 或非法 partition When 迁移 Then 忽略过期记录并拒绝未知分区', async () => {
  await importLegacyCookieProfiles([{ partition: null, cookies: [{ ...cookie, expirationDate: 1 }] }])
  expect(values).toEqual([])
  await expect(importLegacyCookieProfiles([{ partition: 'untrusted-partition', cookies: [] }])).rejects.toThrow('partition 非法')
})
