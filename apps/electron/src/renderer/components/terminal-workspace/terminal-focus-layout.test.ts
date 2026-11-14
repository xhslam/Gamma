import { describe, expect, it } from 'bun:test'
import {
  normalizeFocusLayout,
  normalizeWeights,
  resizeTracks,
} from './terminal-focus-layout'
import {
  isTerminalSessionInWorkspace,
  selectTerminalSessionsForWorkspace,
  selectActiveTerminalSessionId,
} from './terminal-session-scope'

describe('终端工作台布局与分栏 (Terminal Focus Layout)', () => {
  it('Given 异常或越界列数 When 规格化布局 Then 限制在安全列数 1~4 之间且默认 2 列', () => {
    for (const columns of [0, 9, NaN, -1, '4' as any, null as any]) {
      expect(normalizeFocusLayout({ columns }).columns).toBe(2)
    }
    expect(normalizeFocusLayout({ columns: 4 }).columnWeights).toEqual([0.25, 0.25, 0.25, 0.25])
    expect(normalizeFocusLayout({ columns: 1 }).columnWeights).toEqual([1])
  })

  it('Given 拖拽调整分栏 When 调用 resizeTracks Then 仅微调相邻轨道并保持总权重守恒', () => {
    const resized = resizeTracks([0.25, 0.25, 0.25, 0.25], 1, 0.1)
    expect(resized[0]).toBe(0.25)
    expect(resized[1]).toBeCloseTo(0.35)
    expect(resized[2]).toBeCloseTo(0.15)
    expect(resized[3]).toBe(0.25)

    const extreme = resizeTracks([0.25, 0.25, 0.25, 0.25], 1, 99)
    expect(extreme.reduce((a, b) => a + b)).toBeCloseTo(1)
    expect(extreme[2]).toBeCloseTo(0.08)
    expect(resizeTracks([0.5, 0.5], 0, NaN)).toEqual([0.5, 0.5])
  })

  it('Given 非法权重数组 When normalizeWeights Then 输出合法归一化权重', () => {
    expect(normalizeWeights([Infinity, 0.5], 2)).toEqual([0.5, 0.5])
    expect(normalizeWeights([0, 0], 2)).toEqual([0.5, 0.5])
  })

  it('Given 侧边栏折叠状态 When 规格化 Then 严格过滤非布尔值', () => {
    expect(normalizeFocusLayout(null).sidebarCollapsed).toBe(false)
    expect(normalizeFocusLayout({}).sidebarCollapsed).toBe(false)
    expect(normalizeFocusLayout({ sidebarCollapsed: true }).sidebarCollapsed).toBe(true)
    expect(normalizeFocusLayout({ sidebarCollapsed: false }).sidebarCollapsed).toBe(false)
    expect(normalizeFocusLayout({ sidebarCollapsed: 'true' as any }).sidebarCollapsed).toBe(false)
  })
})

describe('终端工作台工作区作用域 (Terminal Workspace Scope)', () => {
  it('Given 工作区实例 ID 与会话记录 When 过滤会话 Then 仅保留匹配或全局未绑定的会话', () => {
    const scopeA = 'focus-workspace'
    const scopeB = 'other-workspace'
    const sessionInA = { id: 's1', workspaceInstanceId: scopeA }
    const sessionInB = { id: 's2', workspaceInstanceId: scopeB }
    const globalSession = { id: 's3', workspaceInstanceId: null }

    expect(isTerminalSessionInWorkspace(sessionInA, scopeA)).toBe(true)
    expect(isTerminalSessionInWorkspace(sessionInB, scopeA)).toBe(false)
    expect(isTerminalSessionInWorkspace(globalSession, scopeA)).toBe(true)

    const filtered = selectTerminalSessionsForWorkspace([sessionInA, sessionInB, globalSession], scopeA)
    expect(filtered.map(s => s.id)).toEqual(['s1', 's3'])
  })

  it('Given 激活会话偏好 When selectActiveTerminalSessionId Then 正确回退到可见会话', () => {
    const scope = 'focus-workspace'
    const sessions = [
      { id: 's1', workspaceInstanceId: scope },
      { id: 's2', workspaceInstanceId: scope },
    ]

    expect(selectActiveTerminalSessionId(sessions, scope, 's2', null)).toBe('s2')
    expect(selectActiveTerminalSessionId(sessions, scope, 'non-existent', 's1')).toBe('s1')
    expect(selectActiveTerminalSessionId(sessions, scope, 'non-existent', 'non-existent-pref')).toBe('s2')
  })
})
