import { describe, expect, test } from 'bun:test'
import { calculateCircleRevealRadius } from './CircleRevealTransition'

describe('calculateCircleRevealRadius', () => {
  test('Given 点击坐标与视口尺寸 When 计算最大覆盖半径 Then 半径大于至最远角的欧氏距离', () => {
    const origin = { x: 400, y: 700 }
    const viewport = { width: 1920, height: 1080 }
    const radius = calculateCircleRevealRadius(origin, viewport)
    // 最远角到 (400, 700) 是 (1920, 0)，距离 = sqrt((1920-400)^2 + 700^2) ≈ 1673
    expect(radius).toBeGreaterThan(1670)
  })

  test('Given 中心原点 When 计算半径 Then 半径能够覆盖四角', () => {
    const origin = { x: 960, y: 540 }
    const viewport = { width: 1920, height: 1080 }
    const radius = calculateCircleRevealRadius(origin, viewport)
    const expectedDiagonalHalf = Math.hypot(960, 540)
    expect(radius).toBeGreaterThanOrEqual(expectedDiagonalHalf)
  })
})
