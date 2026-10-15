import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(import.meta.dir, '../styles/globals.css'), 'utf8')

describe('Given Claude 风格的共享视觉契约', () => {
  test('When 组件使用语义令牌 Then 表面、轮廓、圆角与输入反馈都有独立定义', () => {
    for (const token of ['surface-0', 'surface-1', 'surface-2', 'surface-3', 'hairline-width', 'input-shadow', 'input-shadow-hover', 'input-shadow-focus', 'floating-outline', 'radius-input', 'radius-message', 'radius-dialog', 'motion-fast']) {
      expect(css).toContain(`--${token}:`)
    }
  })
  test('When DPR 或减少动态效果偏好改变 Then 提供对应媒体规则', () => {
    expect(css).toContain('(min-resolution: 2dppx)')
    expect(css).toContain('(min-resolution: 3dppx)')
    expect(css).toContain('.gamma-ui')
    expect(css).toContain('prefers-reduced-motion: reduce')
  })
})
