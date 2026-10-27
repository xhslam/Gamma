import type { PersistedTabState, TabItem } from '@/atoms/tab-atoms'
import { isWorkspaceComponentTab, type AgentSidePanelTab } from '@/atoms/agent-atoms'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** 旧 Chat 标签只丢弃入口，不读取、迁移或删除其历史文件。 */
export function restoreAgentOnlyTabState(state: unknown, agentSessionIds: ReadonlySet<string>): PersistedTabState {
  if (!isRecord(state) || !Array.isArray(state.tabs)) return { tabs: [], activeTabId: null }
  const tabs: TabItem[] = []
  const seen = new Set<string>()
  for (const item of state.tabs) {
    if (!isRecord(item) || item.type !== 'agent' || typeof item.id !== 'string'
      || typeof item.sessionId !== 'string' || typeof item.title !== 'string'
      || !agentSessionIds.has(item.sessionId) || seen.has(item.sessionId)) continue
    seen.add(item.sessionId)
    // 当前会话入口 ID 与真实 Agent ID 一致，不能保留旧产品标签 ID。
    tabs.push({ id: item.sessionId, type: 'agent', sessionId: item.sessionId, title: item.title })
  }
  const validIds = new Set(tabs.map((tab) => tab.id))
  const activeCandidates: unknown[] = [state.activeTabId]
  if (isRecord(state.splitLayout) && Array.isArray(state.splitLayout.panels)) {
    const panels = state.splitLayout.panels
    const index = typeof state.splitLayout.focusedPanelIndex === 'number' ? state.splitLayout.focusedPanelIndex : 0
    const focused = panels[index]
    if (isRecord(focused)) activeCandidates.push(focused.activeTabId)
    for (const panel of panels) if (isRecord(panel)) activeCandidates.push(panel.activeTabId)
  }
  const activeTabId = activeCandidates.find((id): id is string => typeof id === 'string' && validIds.has(id))
    ?? tabs[0]?.id ?? null
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  return { tabs: activeTab ? [activeTab] : [], activeTabId }
}

/** 旧问答页和非法侧栏值保留兼容值；SidePanel 会恢复有效内容或收起空工作区。 */
export function normalizeAgentSidePanelTab(tab: unknown): AgentSidePanelTab {
  if (typeof tab !== 'string') return 'files'
  // 项目组件使用同一份注册表：不能出现 Tab 可见但路由归一化又回退为 files 的断层。
  if (isWorkspaceComponentTab(tab)) return tab
  if (['files', 'changes', 'temporary-agent', 'delegation', 'agy-tasks'].includes(tab)) {
    return tab as AgentSidePanelTab
  }
  if (/^(exploration|browser|preview|terminal|agy):.+$/.test(tab)) return tab as AgentSidePanelTab
  return 'files'
}
