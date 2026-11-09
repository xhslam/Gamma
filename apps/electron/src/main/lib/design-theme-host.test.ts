import { describe, expect, test } from 'bun:test'
import type { DesignThemeSnapshot } from '@gamma/shared'
import { createDesignThemeHost } from './design-theme-host'
import type { DesignThemeWebContents } from './design-theme-host'

const dark: DesignThemeSnapshot = { mode: 'dark', background: '#1f1e1d', panel: '#262624', inset: '#30302e', text: '#f0eee6', secondary: '#b0aea5', tertiary: '#85837b', border: '#f0eee61f', accent: '#d97757', accentText: '#141413', danger: '#d97757', ring: '#d97757', fontFamily: 'system-ui, sans-serif', radius: 6 }
const light = { ...dark, mode: 'light' as const, panel: '#ffffff', text: '#141413' }
const URL = 'http://127.0.0.1:43210/design/artifact/'
function fixture() {
  const listeners = new Map<string, Array<() => void>>()
  const styles: string[] = []
  const removed: string[] = []
  let url = URL
  let destroyed = false
  const contents: DesignThemeWebContents = {
    isDestroyed: () => destroyed,
    getURL: () => url,
    insertCSS: async (css, options) => { expect(options.cssOrigin).toBe('user'); styles.push(css); return `style-${styles.length}` },
    removeInsertedCSS: async (key) => { removed.push(key) },
    on: (event, listener) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]) },
  }
  return { contents, styles, removed, host: createDesignThemeHost(),
    event: (name: string) => { for (const listener of listeners.get(name) ?? []) listener() },
    navigate: (next: string) => { url = next }, destroy: () => { destroyed = true },
  }
}
async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('Given 仅绑定原版编辑器主文档的主题宿主', () => {
  test('When 从深色换到浅色 Then 替换旧样式而非叠加反色或改变布局', async () => {
    const f = fixture()
    await f.host.setTheme(f.contents, URL, dark)
    await f.host.setTheme(f.contents, URL, light)
    expect(f.styles).toHaveLength(2)
    expect(f.styles[1]).toContain('--cds-surface-2: #ffffff')
    expect(f.removed).toEqual(['style-1'])
  })
  test('When 编辑器主页面重载 Then 恢复最新主题且不向子 frame 注入脚本', async () => {
    const f = fixture()
    await f.host.setTheme(f.contents, URL, dark)
    f.event('did-navigate'); f.event('did-finish-load'); await flush()
    expect(f.styles).toHaveLength(2)
    expect(f.styles[0]).toBe(f.styles[1])
    expect(f.removed).toEqual([])
  })
  test('When 标签导航到外部网页或作品预览 Then 不继续注入主题', async () => {
    for (const next of ['https://example.com/', `${URL}project/Main.dc.html`]) {
      const f = fixture()
      await f.host.setTheme(f.contents, URL, dark)
      f.navigate(next); f.event('did-navigate'); f.event('did-finish-load'); await flush()
      expect(f.styles).toHaveLength(1)
      await expect(f.host.setTheme(f.contents, URL, light)).rejects.toThrow('主页面')
    }
  })
  test('When 快速切换主题 Then 尚未插入的旧快照失效，只应用最新值', async () => {
    const f = fixture()
    const first = f.host.setTheme(f.contents, URL, dark)
    const second = f.host.setTheme(f.contents, URL, light)
    await Promise.all([first, second])
    expect(f.styles).toHaveLength(1)
    expect(f.styles[0]).toContain('--cds-surface-2: #ffffff')
  })
  test('When 插入样式返回期间发生跨站导航 Then 移除迟到的样式', async () => {
    const f = fixture()
    f.contents.insertCSS = async (css) => { f.styles.push(css); f.navigate('https://example.com/'); return 'late' }
    await f.host.setTheme(f.contents, URL, dark)
    expect(f.removed).toEqual(['late'])
  })
})
