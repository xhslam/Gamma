import { describe, expect, test } from 'bun:test'
import { createContext, runInContext } from 'node:vm'
import { createDesignLocaleHost } from './design-locale-host'
import type { DesignLocaleWebContents } from './design-locale-host'
import { DESIGN_LOCALE_STORAGE_KEY } from './design-locale-policy'

const URL = 'http://127.0.0.1:43210/design/artifact/'
function fixture() {
  const listeners = new Map<string, Set<() => void>>()
  const values = new Map<string, string>()
  let url = URL
  let destroyed = false
  let reloads = 0
  const scripts: string[] = []
  const context = createContext({ __gammaDesignLocale: 'en-US', sessionStorage: { setItem: (key: string, value: string) => { values.set(key, value) } } })
  const contents: DesignLocaleWebContents = {
    getURL: () => url, isDestroyed: () => destroyed,
    executeJavaScript: async (script) => { scripts.push(script); return runInContext(script, context) as unknown },
    reload: () => { reloads++; context.__gammaDesignLocale = values.get(DESIGN_LOCALE_STORAGE_KEY); queueMicrotask(() => { for (const listener of [...(listeners.get('did-finish-load') ?? [])]) listener() }) },
    once: (event, listener) => { const callbacks = listeners.get(event) ?? new Set(); callbacks.add(listener); listeners.set(event, callbacks) },
    removeListener: (event, listener) => { listeners.get(event)?.delete(listener) },
  }
  return { contents, context, values, scripts, host: createDesignLocaleHost(), get reloads() { return reloads }, navigate: (value: string) => { url = value }, destroy: () => { destroyed = true }, listeners }
}

describe('Given 主进程显式提供系统语言的 design 语言宿主', () => {
  test('When 中文 OS 遇到 Chromium 默认英文 Then 只存当前 origin 的语言并重载一次，验证实际初始化结果', async () => {
    const f = fixture()
    await f.host.setLocale(f.contents, URL, ['zh-CN'])
    expect(f.values.get(DESIGN_LOCALE_STORAGE_KEY)).toBe('zh-CN')
    expect(f.context.__gammaDesignLocale).toBe('zh-CN')
    expect(f.reloads).toBe(1)
    expect(f.scripts).toHaveLength(2)
    expect(f.listeners.get('did-finish-load')?.size).toBe(0)
    expect(f.listeners.get('destroyed')?.size).toBe(0)
  })
  test('When 并发设置语言或 OS 设置随后变更 Then 不重复重载已打开的编辑器或丢失编辑状态', async () => {
    const f = fixture()
    await Promise.all([f.host.setLocale(f.contents, URL, ['zh-CN']), f.host.setLocale(f.contents, URL, ['zh-CN'])])
    await f.host.setLocale(f.contents, URL, ['en-US'])
    expect(f.reloads).toBe(1)
    expect(f.context.__gammaDesignLocale).toBe('zh-CN')
  })
  test('When 英文 OS 与现有语言一致 Then 不重载', async () => {
    const f = fixture()
    await f.host.setLocale(f.contents, URL, ['en-US', 'zh-CN'])
    expect(f.reloads).toBe(0)
    expect(f.values.get(DESIGN_LOCALE_STORAGE_KEY)).toBe('en-US')
  })
  test('When 导航到其他网站或作品预览 Then 不注入、不存储、不重载', async () => {
    for (const target of ['https://example.com/', `${URL}project/Main.dc.html`, 'http://127.0.0.1:43210/design/other/']) {
      const f = fixture(); f.navigate(target)
      await expect(f.host.setLocale(f.contents, URL, ['zh-CN'])).rejects.toThrow('主页面')
      expect(f.scripts).toHaveLength(0)
      expect(f.reloads).toBe(0)
    }
  })
  test('When 脚本返回前导航离开 Then 不重载外部页面', async () => {
    const f = fixture()
    f.contents.executeJavaScript = async () => { f.navigate('https://example.com'); return true }
    await expect(f.host.setLocale(f.contents, URL, ['zh-CN'])).rejects.toThrow('取消语言初始化')
    expect(f.reloads).toBe(0)
  })
  test('When 内置资源未升级 Then 报告构建缺口而非无限重载', async () => {
    const f = fixture(); delete f.context.__gammaDesignLocale
    await expect(f.host.setLocale(f.contents, URL, ['zh-CN'])).rejects.toThrow('重新构建')
    expect(f.reloads).toBe(0)
  })
  test('When 重载未应用语言 Then 不误报成功也不重放', async () => {
    const f = fixture()
    f.contents.reload = () => { queueMicrotask(() => { for (const listener of [...(f.listeners.get('did-finish-load') ?? [])]) listener() }) }
    await expect(f.host.setLocale(f.contents, URL, ['zh-CN'])).rejects.toThrow('初始化失败')
    await expect(f.host.setLocale(f.contents, URL, ['zh-CN'])).rejects.toThrow('初始化失败')
    expect(f.scripts).toHaveLength(2)
  })
  test('When 页面已销毁 Then 不执行任何脚本', async () => {
    const f = fixture(); f.destroy()
    await expect(f.host.setLocale(f.contents, URL, ['zh-CN'])).rejects.toThrow('主页面')
    expect(f.scripts).toHaveLength(0)
  })
})
