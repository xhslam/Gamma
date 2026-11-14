import { describe, expect, test } from 'bun:test'
import { getNextThemeIndex } from './ThemeFloatingDock'

describe('ThemeFloatingDock 键盘导航', () => {
  test('Given 当前选中第 2 个 When 按右键 Then 索引递增至 3', () => {
    expect(getNextThemeIndex(2, 'ArrowRight', 8)).toBe(3)
  })
  test('Given 当前在末尾 When 按右键 Then 循环回到 0', () => {
    expect(getNextThemeIndex(7, 'ArrowRight', 8)).toBe(0)
  })
  test('Given 当前在开头 When 按左键 Then 循环回到末尾 7', () => {
    expect(getNextThemeIndex(0, 'ArrowLeft', 8)).toBe(7)
  })
  test('Given 当前在第 4 个 When 按左键 Then 索引递减至 3', () => {
    expect(getNextThemeIndex(4, 'ArrowLeft', 8)).toBe(3)
  })
})
