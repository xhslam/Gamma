import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'

const tokenPath = resolve(import.meta.dir, 'design-tokens.css')
const palette = new Set(['#1f1e1d', '#262624', '#30302e', '#f0eee6', '#b0aea5', '#85837b', '#d97757', '#faf9f5', '#ffffff', '#141413', '#5e5d59', '#8a887f'])

describe('Given 仅使用指定暖色板的全局设计令牌', () => {
  test('When 读取颜色单一源 Then 只包含指定色值且包含完整亮暗映射', () => {
    expect(existsSync(tokenPath)).toBe(true)
    const css = readFileSync(tokenPath, 'utf8')
    const colors = [...css.matchAll(/#[\da-f]{6}\b/gi)].map(match => match[0].toLowerCase())
    expect(new Set(colors)).toEqual(palette)
    const rules = new Map<string, Map<string, string>>()
    postcss.parse(css).walkRules(rule => {
      const declarations = new Map<string, string>()
      rule.walkDecls(decl => { declarations.set(decl.prop, decl.value) })
      rules.set(rule.selector, declarations)
    })
    expect(rules.get(':root')?.get('--background')).toBe('var(--palette-light-background-hsl)')
    expect(rules.get('.dark')?.get('--background')).toBe('var(--palette-dark-background-hsl)')
    expect(rules.get('.dark')?.get('--border')).toBe('var(--palette-light-background-hsl) / 0.08')
    expect(rules.get(':root')?.get('--border')).toBe('var(--palette-light-text-hsl) / 0.08')
  })

  test('When 检查应用自有 UI 源码 Then 不保留硬编码色板或 Tailwind 内置颜色', () => {
    const renderer = resolve(import.meta.dir, '..')
    const roots = [renderer, resolve(import.meta.dir, '../../../../../packages/ui/src')]
    const violations: string[] = []
    function inspect(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) { if (entry.name !== 'vmark') inspect(path); continue }
        // 遮罩中的黑色只编码 alpha，不是可见 UI 色；用户资源/图片也不重着色。
        if (!/\.(?:ts|tsx|css)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name) || ['design-tokens.css', 'scroll-fade-policy.ts'].includes(entry.name)) continue
        const code = readFileSync(path, 'utf8').split('\n').filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n')
        if (/(?:['"`]|:\s*)#[\da-f]{3,8}\b|(?:rgba?|hsla?)\(\s*\d|(?:text|bg|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|(?:stroke|fill)=["'](?:white|black)["']/i.test(code)) violations.push(path)
      }
    }
    for (const root of roots) inspect(root)
    expect(violations).toEqual([])
  })

  test('When 组件消费颜色 Then CSS 中不再出现独立色值或冷灰覆盖', () => {
    const paths = ['globals.css', '../components/agent/process-timeline.css', '../components/welcome/code-field-background.css']
    for (const path of paths) {
      const css = readFileSync(resolve(import.meta.dir, path), 'utf8')
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(withoutComments).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(\s*\d/i)
    }
  })
})
