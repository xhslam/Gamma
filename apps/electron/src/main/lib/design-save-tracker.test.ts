import { expect, test } from 'bun:test'
import { DesignSaveTracker } from './design-save-tracker'
import { createDesignBrowserPolicy } from './design-browser-policy'

test('Given 已登记的编辑器 When 观察写请求 Then 只跟踪内容写入，不跟踪读取、分享或其他站点', () => {
  const policy = createDesignBrowserPolicy()
  const dispose = policy.registerDesignEditorOrigin('http://127.0.0.1:45678/dashboard/token/')
  const write = { url: 'http://127.0.0.1:45678/_api/write', method: 'POST' }
  expect(policy.isDesignEditorWriteRequest(write)).toBe(true)
  expect(policy.isDesignEditorWriteRequest({ ...write, method: 'GET' })).toBe(false)
  expect(policy.isDesignEditorWriteRequest({ ...write, url: 'http://127.0.0.1:45678/__share/archive' })).toBe(false)
  expect(policy.isDesignEditorWriteRequest({ ...write, url: 'https://example.com/_api/write' })).toBe(false)
  dispose()
  expect(policy.isDesignEditorWriteRequest(write)).toBe(false)
})

test('Given 尚未完成的内容写入 When 生成完整稿 Then 必须等待对应页面写完，并隔离其他页面的未完成写入', async () => {
  const saves = new DesignSaveTracker()
  saves.started(1, 10)
  saves.started(2, 20)
  let completed = false
  const waiting = saves.wait(10, { timeoutMs: 500, quietMs: 10 }).then(() => { completed = true })
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(completed).toBe(false)
  saves.finished(1, true)
  await waiting
  expect(completed).toBe(true)
  await expect(saves.wait(20, { timeoutMs: 25, quietMs: 0 })).rejects.toThrow('仍在写入')
})

test('Given 保存请求失败 When 交付完整稿 Then 不把失败当作已保存；重试成功或新页面才解除失败', async () => {
  const saves = new DesignSaveTracker()
  saves.started(1, 10); saves.finished(1, false)
  await expect(saves.wait(10, { quietMs: 0 })).rejects.toThrow('写入失败')
  saves.started(2, 10); saves.finished(2, true)
  await saves.wait(10, { quietMs: 0 })
  saves.started(3, 10); saves.finished(3, false)
  saves.clear(10)
  await saves.wait(10, { quietMs: 0 })
})
