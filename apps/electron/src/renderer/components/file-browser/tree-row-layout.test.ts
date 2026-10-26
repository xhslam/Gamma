import { describe, expect, test } from 'bun:test'
import { canBeSticky, computeTreeRowLayout } from './tree-row-layout'

describe('Given 统一34px文件树行与吸顶祖先链', () => {
  for (const depth of [0, 1, 7]) {
    test(`When 深度为${depth} Then 吸顶偏移与34px行高一致且保留层级缩进`, () => {
      const layout = computeTreeRowLayout(depth)
      expect(layout.stickyTop).toBe(depth * 34)
      expect(layout.paddingLeft).toBe(16 + depth * 16)
      expect(layout.guideLeft).toBe(layout.paddingLeft + 7)
      expect(canBeSticky(depth)).toBe(true)
    })
  }
  test('When 深度超过吸顶栈上限 Then 保留正常滚动而不把目录互相叠压', () => {
    expect(canBeSticky(8)).toBe(false)
    expect(canBeSticky(9)).toBe(false)
  })
})
