import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { restoreAgentOnlyTabState, normalizeAgentSidePanelTab } from './agent-only-state'
import { sanitizeRightWorkspaceSplit } from './right-workspace-split'
import { getStopGenerationTarget, resolveStopGenerationTarget } from './stop-generation-target'
import { WORKSPACE_COMPONENT_TABS, type AgentSidePanelTab } from '@/atoms/agent-atoms'
import type { TabItem } from '@/atoms/tab-atoms'

const agent = (id: string): TabItem => ({ id, type: 'agent', sessionId: id, title: id })
const chat = { id: 'chat-history', type: 'chat', sessionId: 'chat-history', title: '历史聊天' }

describe('Given 旧 Chat 与 Agent 混合入口状态', () => {
  test('When 恢复 Chat-only Then 空入口进入正常 Agent 欢迎流程且原对象不变', () => {
    const state = { tabs: [chat], activeTabId: chat.id }
    const before = JSON.stringify(state)
    expect(restoreAgentOnlyTabState(state, new Set(['agent-a']))).toEqual({ tabs: [], activeTabId: null })
    expect(JSON.stringify(state)).toBe(before)
  })

  test('When Chat 占据焦点 Then 只保留经过真实 Agent ID 校验的有效入口', () => {
    const state = { tabs: [chat, agent('deleted'), agent('agent-a')], activeTabId: chat.id }
    expect(restoreAgentOnlyTabState(state, new Set(['agent-a']))).toEqual({ tabs: [agent('agent-a')], activeTabId: 'agent-a' })
    expect(restoreAgentOnlyTabState({ tabs: [agent('chat-history')] }, new Set(['agent-a'])).tabs).toEqual([])
  })

  test('When 旧分屏聚焦 Chat Then 从剩余面板恢复有效 Agent 焦点', () => {
    const state = {
      tabs: [chat, agent('agent-a'), agent('agent-b')], activeTabId: chat.id,
      splitLayout: { focusedPanelIndex: 0, panels: [{ activeTabId: chat.id }, { activeTabId: 'agent-b' }] },
    }
    expect(restoreAgentOnlyTabState(state, new Set(['agent-a', 'agent-b']))).toEqual({ tabs: [agent('agent-b')], activeTabId: 'agent-b' })
  })

  test('When 状态无效或重复 Then 不恢复非法标签也不抛错', () => {
    expect(restoreAgentOnlyTabState(null, new Set())).toEqual({ tabs: [], activeTabId: null })
    expect(restoreAgentOnlyTabState({ tabs: [null, {}, agent('agent-a'), agent('agent-a')] }, new Set(['agent-a'])).tabs).toHaveLength(1)
  })

  test('When 任一已注册项目组件进入真实右侧容器 Then 保留选择，不误回退到文件', () => {
    for (const component of WORKSPACE_COMPONENT_TABS) expect(normalizeAgentSidePanelTab(component)).toBe(component)
    expect(normalizeAgentSidePanelTab('unregistered-component')).toBe('files')
  })

  test('When 侧栏旧值为 chat Then 文件页回退且有效分屏保留', () => {
    expect(normalizeAgentSidePanelTab('chat')).toBe('files')
    expect(normalizeAgentSidePanelTab('preview:doc')).toBe('preview:doc')
    expect(normalizeAgentSidePanelTab('agy:task')).toBe('agy:task')
    expect(normalizeAgentSidePanelTab('agy-tasks')).toBe('agy-tasks')
    expect(normalizeAgentSidePanelTab('agy:')).toBe('files')
    const leftTab = normalizeAgentSidePanelTab('chat')
    const repaired = sanitizeRightWorkspaceSplit({ leftTab, rightTab: 'changes', focusedPane: 'left', ratio: 0.5 }, new Set<AgentSidePanelTab>(['files', 'changes']))
    expect(repaired.activeTab).toBe('files')
    expect(repaired.split?.rightTab).toBe('changes')
  })
})

describe('Given Agent-only 产品入口', () => {
  test('When 加载主入口、侧栏与操作链 Then 不调用任何 Chat IPC 或保留伪模式状态', () => {
    const paths = ['../main.tsx', '../components/app-shell/LeftSidebar.tsx', '../components/app-shell/SearchDialog.tsx', '../components/shortcuts/GlobalShortcuts.tsx', '../components/quick-task/QuickTaskApp.tsx', '../components/welcome/WelcomeView.tsx', '../hooks/useCreateSession.ts', '../components/session-preview/SessionMiniMapPopover.tsx']
    for (const path of paths) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).not.toMatch(/electronAPI\.(?:listConversations|createConversation|deleteConversation|searchConversationMessages|getConversationMessages|togglePinConversation|toggleArchiveConversation)/)
      expect(source).not.toContain('appModeAtom')
      expect(source).not.toContain('chat-atoms')
    }
  })

  test('When 渲染侧栏 Then 整条模式栏及其留白容器消失，固定布局与过渡保持', () => {
    const sidebar = readFileSync(new URL('../components/app-shell/LeftSidebar.tsx', import.meta.url), 'utf8')
    const shell = readFileSync(new URL('../components/app-shell/AppShell.tsx', import.meta.url), 'utf8')
    expect(sidebar).not.toContain('ModeSwitcher')
    expect(sidebar).not.toContain('pb-3 pt-1')
    expect(sidebar).toContain('新建任务')
    expect(shell).toContain('<SidebarTransition collapsed={sidebarCollapsed} width={LEFT_SIDEBAR_WIDTH}>')
    expect(shell).toContain('<LeftSidebar width={LEFT_SIDEBAR_WIDTH} />')
  })

  test('When 停止生成事件指向旧 Chat Then 拒绝目标；预览与委派仍操作 Agent', () => {
    expect(getStopGenerationTarget(new CustomEvent('stop', { detail: { kind: 'chat', sessionId: 'old' } }))).toBeNull()
    expect(resolveStopGenerationTarget({ type: 'preview', sessionId: 'agent-a' }, undefined)).toEqual({ kind: 'agent', sessionId: 'agent-a' })
    expect(resolveStopGenerationTarget({ type: 'agent', sessionId: 'agent-a' }, 'delegation', { type: 'agent', sessionId: 'child' })).toEqual({ kind: 'agent', sessionId: 'child' })
  })
})
