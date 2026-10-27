import { describe, expect, test } from 'bun:test'
import { clampRightPanelWidth, getWorkspaceResizeWidth, MIN_MAIN_AREA_WIDTH } from './right-panel-layout'

describe('Given 可位于两侧的展示工作区', () => {
  test('When 拖动与 Agent 相邻的边界 Then 宽度按工作区所在侧增减', () => {
    expect(getWorkspaceResizeWidth(460, 500, 560, 'left')).toBe(520)
    expect(getWorkspaceResizeWidth(460, 500, 560, 'right')).toBe(400)
    expect(getWorkspaceResizeWidth(460, 500, 440, 'left')).toBe(400)
    expect(getWorkspaceResizeWidth(460, 500, 440, 'right')).toBe(520)
  })

  test('When 在窄窗口或极限位置调整任一侧 Then 保留 Agent 最小宽度且不产生负宽度', () => {
    for (const side of ['left', 'right'] as const) {
      const expanded = getWorkspaceResizeWidth(460, 0, side === 'left' ? 10_000 : -10_000, side)
      expect(clampRightPanelWidth(expanded, 900, 360, 61, true)).toBe(900 - 61 - MIN_MAIN_AREA_WIDTH - 16)
      expect(clampRightPanelWidth(-10_000, 900, 360, 61, true)).toBe(360)
      expect(clampRightPanelWidth(expanded, 300, 360, 61, true)).toBe(0)
    }
  })
})

describe('Given 完全收起且零宽度的左侧导航', () => {
  test('When 工作区占用释放空间 Then 不再扣除图标栏宽度并保留 Agent 最小宽度', () => {
    for (const side of ['left', 'right'] as const) {
      const width = getWorkspaceResizeWidth(460, 0, side === 'left' ? 10_000 : -10_000, side)
      expect(clampRightPanelWidth(width, 900, 360, 0, true)).toBe(900 - MIN_MAIN_AREA_WIDTH - 16)
      expect(clampRightPanelWidth(width, 300, 360, 0, true)).toBe(0)
    }
  })
})
