import { describe, expect, test } from 'bun:test'
import type { DesignThemeSnapshot } from '@gamma/shared'
import { buildDesignThemeCss, matchesDesignEditorThemeUrl, parseDesignTheme } from './design-theme-policy'

export const designTestTheme: DesignThemeSnapshot = {
  mode: 'dark', background: '#1f1e1d', panel: '#262624', inset: '#30302e', text: '#f0eee6',
  secondary: '#b0aea5', tertiary: '#85837b', border: '#f0eee61f', accent: '#d97757', accentText: '#141413',
  danger: '#d97757', ring: '#d97757', fontFamily: '"Inter Variable", -apple-system, sans-serif', radius: 6,
}

describe('Given Gamma 的 design 外壳主题', () => {
  test('When 同步主题 Then 映射 CDS 外观变量，不修改布局、作品选择器或 iframe', () => {
    const css = buildDesignThemeCss(designTestTheme)
    expect(css).toContain(':root.cds-root, :root.cds-root .cds-root')
    expect(css).toContain('--t-fg: #f0eee6')
    expect(css).toContain('--cds-surface-2: #262624 !important')
    expect(css).toContain('--cds-text-primary: #f0eee6 !important')
    expect(css).toContain('--cds-on-primary: #141413 !important')
    expect(css).toContain('--cds-radius: 6px !important')
    expect(css).not.toMatch(/(?:iframe|canvas|h1|button|\*)\s*\{/)
    expect(css).not.toMatch(/(?:^|\n)\s*(?:display|width|height|position|overflow|transform)\s*:/)
    expect(css).not.toContain('filter:')
    expect(css).not.toContain('color-scheme:')
    expect(css).not.toContain('@import')
  })
  test('When 颜色或字体携带 CSS/URL/脚本 Then IPC 解析拒绝而不拼接到样式', () => {
    for (const color of ['red', '#fff', '#ffffff;display:none', 'url(https://example.com)', 'var(--secret)', '<script>']) {
      expect(() => parseDesignTheme({ ...designTestTheme, accent: color })).toThrow()
    }
    for (const fontFamily of ['x; background:red', 'url(https://example.com)', 'x}body{display:none', '']) {
      expect(() => parseDesignTheme({ ...designTestTheme, fontFamily })).toThrow()
    }
    for (const radius of [NaN, Infinity, -1, 33, '6']) expect(() => parseDesignTheme({ ...designTestTheme, radius })).toThrow()
    expect(() => parseDesignTheme({ ...designTestTheme, mode: 'unknown' })).toThrow()
  })
  test('When 五类编辑器切页或跳到作品预览 Then 仅编辑器主路径命中主题边界', () => {
    for (const kind of ['slides', 'design', 'design-system', 'dashboard', 'motion']) {
      const url = `http://127.0.0.1:43210/${kind}/artifact/`
      expect(matchesDesignEditorThemeUrl(url, `${url}#page-first`)).toBe(true)
      expect(matchesDesignEditorThemeUrl(url, `${url}?view=editor`)).toBe(true)
      for (const other of [`${url}project/Main.dc.html`, url.replace('/artifact/', '/artifact-other/'), url.replace('43210', '43211'), 'https://example.com/']) {
        expect(matchesDesignEditorThemeUrl(url, other)).toBe(false)
      }
    }
  })
})
