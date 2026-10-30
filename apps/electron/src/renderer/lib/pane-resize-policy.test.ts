import { describe, expect, test } from 'bun:test'
import { hasPaneResizeStarted } from './pane-resize-policy'
import { clampRightWorkspaceSplitRatioForWidth, clampRightWorkspaceSplitRatio } from './right-workspace-split'
import { clampRightPanelWidth, getWorkspaceResizeWidth } from '../components/app-shell/right-panel-layout'

describe('Given 分栏死区和可行宽度', () => {
  test('When 位移不超过4px Then 不激活拖动；两个方向超过后才激活', () => {
    for (const delta of [0, 1, -1, 4, -4]) expect(hasPaneResizeStarted(100, 100 + delta)).toBe(false)
    for (const delta of [4.1, -4.1, 100]) expect(hasPaneResizeStarted(100, 100 + delta)).toBe(true)
  })
  test('When 窄窗口、非有限输入或无可用宽度 Then 返回可恢复且有限的布局', () => {
    for (const width of [0, 4, 8, 200, 648, 1200, NaN, Infinity]) {
      for (const ratio of [-1, 0, 0.5, 1, 2, NaN, Infinity]) {
        const actual = clampRightWorkspaceSplitRatioForWidth(ratio, width)
        expect(Number.isFinite(actual)).toBe(true)
        expect(actual).toBeGreaterThanOrEqual(0.3)
        expect(actual).toBeLessThanOrEqual(0.7)
        if (width <= 648 || !Number.isFinite(width)) expect(actual).toBe(0.5)
        expect(clampRightPanelWidth(NaN, width, 300, 240)).toBeGreaterThanOrEqual(0)
      }
    }
    expect(clampRightWorkspaceSplitRatio(NaN)).toBe(0.5)
  })
  test('When 交换左右工作区 Then 相同指针方向的宽度变化相反', () => {
    expect(getWorkspaceResizeWidth(300, 100, 140, 'left')).toBe(340)
    expect(getWorkspaceResizeWidth(300, 100, 140, 'right')).toBe(260)
  })
  test('When 使用默认均分比例 Then 在窄宽窗口均遵守可行比例', () => {
    for (const width of [0, 200, 648, 1200]) expect(clampRightWorkspaceSplitRatioForWidth(0.5, width)).toBe(0.5)
  })
})
