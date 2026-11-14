import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentDiffPanelTabAtom, agentSessionComponentTabsAtomFamily, agentSidePanelOpenAtomFamily, currentAgentSessionIdAtom, isUserPriorityWorkspaceComponentTab, isWorkspaceComponentTab, openWorkspaceComponentAtom, revealChangedWorkspaceComponentAtom } from '../../atoms/agent-atoms'
import { markdownSidebarOpenAtom, markdownRecentVaultNoteAtom } from '../../atoms/markdown-workspace-atoms'

describe('Given Markdown 右侧导航契约', () => {
  test('When 校验 Markdown Tab Then 可识别且拥有用户焦点保护', () => {
    expect(isWorkspaceComponentTab('markdown')).toBe(true)
    expect(isUserPriorityWorkspaceComponentTab('markdown')).toBe(true)
  })
  test('When 当前会话打开 Markdown Then 只打开此会话右侧组件且侧边栏默认关闭', () => {
    const store = createStore(); store.set(currentAgentSessionIdAtom, 'A')
    store.set(markdownSidebarOpenAtom, true)
    store.set(openWorkspaceComponentAtom, 'markdown')
    expect(store.get(agentSessionComponentTabsAtomFamily('A'))).toContain('markdown')
    expect(store.get(agentSidePanelOpenAtomFamily('A'))).toBe(true)
    expect(store.get(agentDiffPanelTabAtom).get('A')).toBe('markdown')
    expect(store.get(agentSessionComponentTabsAtomFamily('B'))).not.toContain('markdown')
    expect(store.get(markdownSidebarOpenAtom)).toBe(false)
  })
  test('When Agent 揭示其他项目组件 Then 不抢走正在阅读/编辑的 Markdown', () => {
    const store = createStore(); store.set(currentAgentSessionIdAtom, 'A'); store.set(openWorkspaceComponentAtom, 'markdown')
    store.set(revealChangedWorkspaceComponentAtom, { sessionId: 'A', component: 'memory' })
    expect(store.get(agentDiffPanelTabAtom).get('A')).toBe('markdown')
  })
  test('When 记录最近打开的 vault 与笔记 Then atom 正常存储并支持按 scopeKey 读取', () => {
    const store = createStore()
    store.set(markdownRecentVaultNoteAtom, {
      'workspace-1': {
        lastVaultName: '我的知识库',
        vaults: {
          '我的知识库': {
            lastNotePath: '日记/2026-11-14.md',
            scrollTop: 120,
            lastOpenedAt: 1700000000000,
          },
        },
      },
    })
    const state = store.get(markdownRecentVaultNoteAtom)
    expect(state['workspace-1']?.lastVaultName).toBe('我的知识库')
    expect(state['workspace-1']?.vaults['我的知识库']?.lastNotePath).toBe('日记/2026-11-14.md')
    expect(state['workspace-1']?.vaults['我的知识库']?.scrollTop).toBe(120)
  })
  test('When 点击 markdown 按钮或打开组件 Then 侧边栏保持默认关闭状态', () => {
    const store = createStore()
    expect(store.get(markdownSidebarOpenAtom)).toBe(false)
    store.set(markdownSidebarOpenAtom, true)
    // 触发打开 markdown
    store.set(currentAgentSessionIdAtom, 'session-test')
    store.set(openWorkspaceComponentAtom, 'markdown')
    expect(store.get(markdownSidebarOpenAtom)).toBe(false)
  })
})
