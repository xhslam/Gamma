import { describe, expect, test } from 'bun:test'
import { CODE_FIELD_RIPPLE_LIFETIME, sampleCodeFieldRipple } from './code-field-ripple'

describe('Given 鼠标移动产生的柔和水光', () => {
  const ripples = [{ x: 100, y: 200, startedAt: 1000 }]
  test('When 波纹传播 Then 宽波峰向外移动而不是锁在光标位置', () => {
    expect(sampleCodeFieldRipple(ripples, 160, 200, 1500)).toBeGreaterThan(sampleCodeFieldRipple(ripples, 100, 200, 1500))
    expect(sampleCodeFieldRipple(ripples, 220, 200, 2000)).toBeGreaterThan(sampleCodeFieldRipple(ripples, 100, 200, 2000))
    expect(sampleCodeFieldRipple(ripples, 220, 200, 2000)).toBe(sampleCodeFieldRipple(ripples, -20, 200, 2000))
  })
  test('When 波光出现和消失 Then 平滑起亮并最终回到静态', () => {
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1000)).toBe(0)
    const first = sampleCodeFieldRipple(ripples, 100, 200, 1001)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(0.001)
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1120)).toBeGreaterThan(first)
    expect(sampleCodeFieldRipple(ripples, 280, 200, 1000 + CODE_FIELD_RIPPLE_LIFETIME - 1)).toBeLessThan(0.00001)
    expect(sampleCodeFieldRipple(ripples, 100, 200, 999)).toBe(0)
    expect(sampleCodeFieldRipple(ripples, 280, 200, 1000 + CODE_FIELD_RIPPLE_LIFETIME)).toBe(0)
    expect(sampleCodeFieldRipple([], 100, 200, 1000)).toBe(0)
  })
  test('When 多条轨迹交叠 Then 平滑叠加而不是硬截断到最大亮度', () => {
    const single = sampleCodeFieldRipple(ripples, 130, 200, 1250)
    const overlap = sampleCodeFieldRipple(Array.from({ length: 12 }, () => ripples[0]!), 130, 200, 1250)
    expect(overlap).toBeGreaterThan(single)
    expect(overlap).toBeLessThan(0.75)
    expect(Number.isFinite(overlap)).toBe(true)
  })
})
