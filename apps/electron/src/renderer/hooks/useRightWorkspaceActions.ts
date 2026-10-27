import * as React from 'react'
import { useAtomValue, useStore } from 'jotai'
import { toast } from 'sonner'
import {
  agentDiffPanelTabAtom, agentSessionComponentTabsAtomFamily, agentSessionPathMapAtom,
  agentSidePanelOpenAtomFamily, agentTerminalTabsAtom, currentAgentSessionIdAtom,
  getBrowserSidePanelTab, getTerminalSidePanelTab,
} from '@/atoms/agent-atoms'
import type { AgentSidePanelTab, WorkspaceComponentTab } from '@/atoms/agent-atoms'
import { browserPanelMinimizedMapAtom, browserPanelOpenMapAtom, browserStateMapAtom, browserFocusRequestMapAtom } from '@/atoms/browser-atoms'
import { activeOnDemandOverlayAtom, toggleOnDemandOverlayAtom } from '@/atoms/on-demand-panel-atoms'
import { productivityToolsAtom } from '@/atoms/ui-preferences'

/** 收起工作区时也能添加内容；异步结果始终写回发起操作的会话。 */
export function useRightWorkspaceActions(sessionId: string) {
  const store = useStore()
  const productivityTools = useAtomValue(productivityToolsAtom)
  const openingBrowserRef = React.useRef(false)
  const activate = React.useCallback((tab: AgentSidePanelTab) => {
    store.set(agentDiffPanelTabAtom, previous => new Map(previous).set(sessionId, tab))
    store.set(agentSidePanelOpenAtomFamily(sessionId), true)
    if (store.get(currentAgentSessionIdAtom) === sessionId) store.set(activeOnDemandOverlayAtom, null)
  }, [sessionId, store])

  const onOpenFile = React.useCallback(() => {
    if (store.get(currentAgentSessionIdAtom) === sessionId) store.set(toggleOnDemandOverlayAtom, 'files')
  }, [sessionId, store])
  const onOpenBrowser = React.useCallback(async () => {
    if (openingBrowserRef.current) return
    openingBrowserRef.current = true
    try {
      const existing = store.get(browserStateMapAtom).get(sessionId)
      const state = existing
        ? await window.electronAPI.createAgentBrowserTab({ sessionId })
        : await window.electronAPI.openAgentBrowser(sessionId)
      store.set(browserStateMapAtom, previous => new Map(previous).set(sessionId, state))
      store.set(browserPanelMinimizedMapAtom, previous => {
        const next = new Map(previous)
        next.delete(sessionId)
        return next
      })
      store.set(browserPanelOpenMapAtom, previous => new Map(previous).set(sessionId, true))
      store.set(browserFocusRequestMapAtom, previous => new Map(previous).set(sessionId, state.activeTabId))
      activate(getBrowserSidePanelTab(state.activeTabId))
    } catch (error) {
      console.error('[RightWorkspace] 新建浏览器标签失败:', error)
      toast.error('无法打开浏览器标签')
    } finally {
      openingBrowserRef.current = false
    }
  }, [activate, sessionId, store])
  const onOpenTerminal = React.useCallback(() => {
    const terminalId = crypto.randomUUID()
    const cwd = store.get(agentSessionPathMapAtom).get(sessionId) ?? undefined
    store.set(agentTerminalTabsAtom, previous => new Map(previous).set(sessionId, [
      ...(previous.get(sessionId) ?? []), { terminalId, title: '终端', cwd },
    ]))
    activate(getTerminalSidePanelTab(terminalId))
  }, [activate, sessionId, store])
  const onOpenWorkspaceComponent = React.useCallback((component: WorkspaceComponentTab) => {
    if ((component === 'todos' && !productivityTools.todosEnabled) || (component === 'calendar' && !productivityTools.calendarEnabled)) return
    store.set(agentSessionComponentTabsAtomFamily(sessionId), previous => previous.includes(component) ? previous : [...previous, component])
    activate(component)
  }, [activate, productivityTools, sessionId, store])
  const onOpenAgyTasks = React.useCallback(() => activate('agy-tasks'), [activate])

  return { onOpenFile, onOpenBrowser, onOpenTerminal, onOpenAgyTasks, onOpenWorkspaceComponent, productivityTools }
}
