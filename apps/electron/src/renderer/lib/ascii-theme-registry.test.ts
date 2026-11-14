import { describe, expect, test } from 'bun:test'
import { ASCII_THEME_REGISTRY, getAsciiThemeDefinition } from './ascii-theme-registry'
import { THEME_STYLES } from '../../types'

describe('ASCII_THEME_REGISTRY', () => {
  test('Given 8 款 ASCII 主题 When 检查注册表 Then 包含所有定义且字段完整', () => {
    const specialIds = THEME_STYLES.filter((id) => id !== 'default')
    expect(specialIds.length).toBe(8)
    for (const id of specialIds) {
      const def = getAsciiThemeDefinition(id)
      expect(def).toBeDefined()
      expect(def.name).toBeTruthy()
      expect(def.englishName).toBeTruthy()
      expect(['light', 'dark']).toContain(def.mode)
      expect(def.backgroundColor).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(def.glyphs.length).toBeGreaterThan(0)
    }
  })

  test('Given default 或无效风格 When 查询 Then 回退至 claude-code', () => {
    expect(getAsciiThemeDefinition('default').id).toBe('claude-code')
    // @ts-expect-error 测试无效传入
    expect(getAsciiThemeDefinition('unknown').id).toBe('claude-code')
  })
})
