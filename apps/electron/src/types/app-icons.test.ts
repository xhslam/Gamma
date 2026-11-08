import { describe, expect, test } from 'bun:test'
import { APP_ICON_VARIANTS, getAppIconResourcePath, isAppIconVariantId, normalizeAppIconVariant } from './app-icons'

const legacyMappings = [
  ['silver-glow', 'charcoal-amber'], ['emerald-gold', 'mint-forest'],
  ['sapphire-silver', 'sky-cobalt'], ['amethyst', 'lavender'],
  ['coral', 'cream-orange'], ['ice-blue', 'midnight-cyan'],
  ['neon-violet', 'aubergine-lilac'], ['ruby-gold', 'terracotta'],
  ['emerald-glow', 'forest-mint'],
] as const

describe('像素图标设置升级', () => {
  test('Given 旧版九款金属配色 When 读取偏好 Then 迁移至接近的新配色而旧ID不能通过切换IPC', () => {
    for (const [oldId, newId] of legacyMappings) {
      expect(normalizeAppIconVariant(oldId)).toBe(newId)
      expect(isAppIconVariantId(oldId)).toBe(false)
      expect(getAppIconResourcePath(oldId)).toBeNull()
    }
  })

  test('Given 十三款新图标 When 重读偏好 Then 保持原选择且每款均可解析', () => {
    for (const variant of APP_ICON_VARIANTS) {
      expect(normalizeAppIconVariant(variant.id)).toBe(variant.id)
      expect(isAppIconVariantId(variant.id)).toBe(true)
      expect(getAppIconResourcePath(variant.id)).not.toBeNull()
    }
  })

  test('Given 缺失、对象原型键与越界路径 When 读取偏好 Then 安全回退默认且不解析任意路径', () => {
    for (const value of [null, undefined, {}, 13, '', '__proto__', 'constructor', 'toString', '../icon', '/tmp/icon.png']) {
      expect(normalizeAppIconVariant(value)).toBe('default')
      expect(isAppIconVariantId(value)).toBe(false)
      expect(getAppIconResourcePath(value)).toBeNull()
    }
  })
})
