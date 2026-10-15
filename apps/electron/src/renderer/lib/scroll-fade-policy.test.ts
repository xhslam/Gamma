import { describe, expect, test } from 'bun:test'
import { getScrollFadeEdges, getScrollFadeMask } from './scroll-fade-policy'

describe('Given 动态滚动边缘遮罩', () => {
  test('When 不溢出 Then 两端均清晰', () => {
    expect(getScrollFadeEdges(200, 300, 0, 28)).toEqual({ start: 0, end: 0 })
  })
  test('When 滚动经过首尾与中间 Then 独立控制两端羽化', () => {
    expect(getScrollFadeEdges(1000, 300, 0, 28)).toEqual({ start: 0, end: 28 })
    expect(getScrollFadeEdges(1000, 300, 200, 28)).toEqual({ start: 28, end: 28 })
    expect(getScrollFadeEdges(1000, 300, 700, 28)).toEqual({ start: 28, end: 0 })
    expect(getScrollFadeEdges(1000, 300, 699.5, 28)).toEqual({ start: 28, end: 0 })
  })
  test('When 需要双轴遮罩 Then 返回两层而不是空对象', () => {
    const mask = getScrollFadeMask('both')
    expect(mask).toContain('to bottom')
    expect(mask).toContain('to right')
    expect(mask).toContain('0.85')
  })
})
