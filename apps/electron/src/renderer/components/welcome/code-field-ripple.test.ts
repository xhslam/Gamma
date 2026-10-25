import { describe, expect, test } from 'bun:test'
import { CODE_FIELD_CLICK_LIFETIME, CODE_FIELD_RIPPLE_LIFETIME, sampleCodeFieldRipple } from './code-field-ripple'

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


describe('Given 点击位置为圆心的水波', () => {
  const ripples = [{ x: 100, y: 200, startedAt: 1000, kind: 'click' as const, strength: 1.6 }]
  test('When 圆环展开 Then 圆心恢复平静，圆周等亮并减速向外传播', () => {
    const radius = (age: number): number => 360 * (1 - (1 - age / CODE_FIELD_CLICK_LIFETIME) ** 2)
    const early = radius(400)
    const later = radius(800)
    expect(later).toBeGreaterThan(early)
    expect(radius(1200) - later).toBeLessThan(later - early)
    const ring = sampleCodeFieldRipple(ripples, 100 + early, 200, 1400)
    expect(ring).toBeGreaterThan(0.3)
    expect(ring).toBe(sampleCodeFieldRipple(ripples, 100 - early, 200, 1400))
    expect(ring).toBe(sampleCodeFieldRipple(ripples, 100, 200 + early, 1400))
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1400)).toBeLessThan(0.01)
    expect(sampleCodeFieldRipple(ripples, 100 + later, 200, 1800)).toBeGreaterThan(sampleCodeFieldRipple(ripples, 100 + early, 200, 1800))
  })
  test('When 点击刚开始或最终消散 Then 无突然亮起或残留', () => {
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1000)).toBe(0)
    expect(sampleCodeFieldRipple(ripples, 100, 200, 1001)).toBeLessThan(0.001)
    expect(sampleCodeFieldRipple(ripples, 460, 200, 1000 + CODE_FIELD_CLICK_LIFETIME - 1)).toBeLessThan(0.0001)
    expect(sampleCodeFieldRipple(ripples, 460, 200, 1000 + CODE_FIELD_CLICK_LIFETIME)).toBe(0)
  })
})
