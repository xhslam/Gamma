import { describe, expect, test } from 'bun:test'
import { getModelSelectorOptionVisualState } from './model-selector-visual-state'

describe('公共模型选项视觉状态', () => {
  test('Given 当前模型同时高亮 When 计算视觉状态 Then 选中标识优先', () => {
    expect(getModelSelectorOptionVisualState(true, true)).toBe('selected')
    expect(getModelSelectorOptionVisualState(true, false)).toBe('selected')
  })

  test('Given 非当前模型 When 高亮或空闲 Then 返回对应状态', () => {
    expect(getModelSelectorOptionVisualState(false, true)).toBe('highlighted')
    expect(getModelSelectorOptionVisualState(false, false)).toBe('idle')
  })
})
