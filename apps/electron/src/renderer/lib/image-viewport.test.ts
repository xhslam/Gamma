import { describe, expect, test } from 'bun:test'
import { constrainImageTransform, zoomImageAt } from './image-viewport'

const viewport = { width: 800, height: 600 }
describe('Given 适配视口的图片', () => {
  test('When 图片未溢出 Then 无法平移露白', () => {
    expect(constrainImageTransform({ scale: 1, x: 500, y: -500 }, { width: 300, height: 200 }, viewport)).toEqual({ scale: 1, x: 0, y: 0 })
  })
  test('When 仅横轴溢出 Then 仅横轴可拖动且不能越过边缘', () => {
    expect(constrainImageTransform({ scale: 2, x: 999, y: -999 }, { width: 600, height: 200 }, viewport)).toEqual({ scale: 2, x: 200, y: 0 })
  })
  test('When 指针处放大 Then 锚点图片坐标不变', () => {
    const next = zoomImageAt({ scale: 2, x: 20, y: 10 }, 3, { x: 100, y: 50 }, viewport, viewport)
    expect(next).toEqual({ scale: 3, x: -20, y: -10 })
    expect((100 - next.x) / next.scale).toBe((100 - 20) / 2)
  })
  test('When 缩小至适配或超出上限 Then 缩放和平移被约束', () => {
    expect(zoomImageAt({ scale: 4, x: 400, y: 300 }, 0.1, { x: 100, y: 100 }, viewport, viewport)).toEqual({ scale: 1, x: 0, y: 0 })
    expect(constrainImageTransform({ scale: 100, x: 0, y: 0 }, viewport, viewport).scale).toBe(8)
  })
})
