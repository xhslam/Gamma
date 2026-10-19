import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentSidePanelOpenAtomFamily, agentSidePanelOpenMapAtom, openWorkspaceComponentAtom, currentAgentSessionIdAtom } from './agent-atoms'

describe('Given 会话工作区侧面板默认收起', () => {
  test('When 首次进入或创建会话 Then 面板保持收起', () => {
    const store = createStore()
    store.set(agentSidePanelOpenMapAtom, {})

    expect(store.get(agentSidePanelOpenAtomFamily(''))).toBe(false)
    expect(store.get(agentSidePanelOpenAtomFamily('new-session'))).toBe(false)
  })

  test('When 已保存会话开关 Then 尊重用户选择且不影响新会话', () => {
    const store = createStore()
    store.set(agentSidePanelOpenMapAtom, { opened: true, closed: false })

    expect(store.get(agentSidePanelOpenAtomFamily('opened'))).toBe(true)
    expect(store.get(agentSidePanelOpenAtomFamily('closed'))).toBe(false)
    expect(store.get(agentSidePanelOpenAtomFamily('new-session'))).toBe(false)
    store.set(agentSidePanelOpenAtomFamily('new-session'), true)
    expect(store.get(agentSidePanelOpenAtomFamily('new-session'))).toBe(true)
    store.set(agentSidePanelOpenAtomFamily('new-session'), false)
    expect(store.get(agentSidePanelOpenAtomFamily('new-session'))).toBe(false)
  })

  test('When 主动打开工作区组件 Then 仍可展开当前会话面板', () => {
    const store = createStore()
    store.set(agentSidePanelOpenMapAtom, {})
    store.set(currentAgentSessionIdAtom, 'active-session')
    store.set(openWorkspaceComponentAtom, 'markdown')

    expect(store.get(agentSidePanelOpenAtomFamily('active-session'))).toBe(true)
    expect(store.get(agentSidePanelOpenAtomFamily('other-session'))).toBe(false)
  })
})
