import { describe, expect, test } from 'bun:test'
import { CODE_FIELD_RIPPLE_LIFETIME, sampleCodeFieldRipple } from './code-field-ripple'

describe('Given 点击字符背景产生的涟漪', () => {
  const ripples = [{ x: 100, y: 200, startedAt: 1000 }]
  test('When 波纹传播 Then 波峰从点击位置向外移动且左右对称', () => {
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1000)).toBeGreaterThan(0.9)
    expect(sampleCodeFieldRipple(ripples, 220, 200, 1500)).toBeGreaterThan(0.5)
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1500)).toBeLessThan(0.001)
    expect(sampleCodeFieldRipple(ripples, 220, 200, 1500)).toBe(sampleCodeFieldRipple(ripples, -20, 200, 1500))
  })
  test('When 时间耗尽或尚未开始 Then 波纹强度归零', () => {
    expect(sampleCodeFieldRipple(ripples, 100, 200, 999)).toBe(0)
    expect(sampleCodeFieldRipple(ripples, 532, 200, 1000 + CODE_FIELD_RIPPLE_LIFETIME)).toBe(0)
    expect(sampleCodeFieldRipple([], 100, 200, 1000)).toBe(0)
  })
  test('When 多次点击重叠 Then 亮度有上限且保持有限数值', () => {
    expect(sampleCodeFieldRipple(Array.from({ length: 6 }, () => ripples[0]!), 100, 200, 1000)).toBe(1)
  })
})
