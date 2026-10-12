import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentDiffPanelTabAtom, agentSessionComponentTabsAtomFamily, agentSidePanelOpenAtomFamily, currentAgentSessionIdAtom, isUserPriorityWorkspaceComponentTab, isWorkspaceComponentTab, openWorkspaceComponentAtom, revealChangedWorkspaceComponentAtom } from '../../atoms/agent-atoms'
describe('Given Markdown 右侧导航契约', () => {
  test('When 校验 Markdown Tab Then 可识别且拥有用户焦点保护', () => {
    expect(isWorkspaceComponentTab('markdown')).toBe(true)
    expect(isUserPriorityWorkspaceComponentTab('markdown')).toBe(true)
  })
  test('When 当前会话打开 Markdown Then 只打开此会话右侧组件', () => {
    const store = createStore(); store.set(currentAgentSessionIdAtom, 'A')
    store.set(openWorkspaceComponentAtom, 'markdown')
    expect(store.get(agentSessionComponentTabsAtomFamily('A'))).toContain('markdown')
    expect(store.get(agentSidePanelOpenAtomFamily('A'))).toBe(true)
    expect(store.get(agentDiffPanelTabAtom).get('A')).toBe('markdown')
    expect(store.get(agentSessionComponentTabsAtomFamily('B'))).not.toContain('markdown')
  })
  test('When Agent 揭示其他项目组件 Then 不抢走正在阅读/编辑的 Markdown', () => {
    const store = createStore(); store.set(currentAgentSessionIdAtom, 'A'); store.set(openWorkspaceComponentAtom, 'markdown')
    store.set(revealChangedWorkspaceComponentAtom, { sessionId: 'A', component: 'memory' })
    expect(store.get(agentDiffPanelTabAtom).get('A')).toBe('markdown')
  })
})
