import * as React from 'react'
import { useAtomValue, useStore } from 'jotai'
import {
  agentDiffPanelTabAtom,
  agentTerminalTabsAtom,
  currentAgentSessionIdAtom,
  currentSessionSidePanelOpenAtom,
  getTerminalSidePanelTab,
} from '@/atoms/agent-atoms'
import { retainTerminalViews } from './TerminalTabContent'

/** 必须与 AppShell 同生命周期，不能随 Agent 面板或 设置/规划/Skills 页面切换卸载。 */
export function TerminalLifecycleObserver(): null {
  const store = useStore()
  const tabs = useAtomValue(agentTerminalTabsAtom)
  React.useEffect(() => { retainTerminalViews(tabs) }, [tabs])
  React.useEffect(() => {
    const close = window.electronAPI.onAgentTerminalClose((event) => {
      store.set(agentTerminalTabsAtom, (previous) => {
        const current = previous.get(event.sessionId) ?? []
        const remaining = current.filter((tab) => tab.terminalId !== event.terminalId)
        if (remaining.length === current.length) return previous
        const next = new Map(previous)
        if (remaining.length) next.set(event.sessionId, remaining)
        else next.delete(event.sessionId)
        return next
      })
      store.set(agentDiffPanelTabAtom, (previous) => {
        if (previous.get(event.sessionId) !== getTerminalSidePanelTab(event.terminalId)) return previous
        const next = new Map(previous)
        next.set(event.sessionId, 'files')
        return next
      })
    })
    const open = window.electronAPI.onAgentTerminalOpen((event) => {
      store.set(agentTerminalTabsAtom, (previous) => {
        const current = previous.get(event.sessionId) ?? []
        if (current.some((tab) => tab.terminalId === event.terminalId)) return previous
        const next = new Map(previous)
        next.set(event.sessionId, [...current, { terminalId: event.terminalId, title: event.title, cwd: event.cwd }])
        return next
      })
      if (event.sessionId !== store.get(currentAgentSessionIdAtom)) return
      store.set(currentSessionSidePanelOpenAtom, true)
      store.set(agentDiffPanelTabAtom, (previous) => new Map(previous).set(event.sessionId, getTerminalSidePanelTab(event.terminalId)))
    })
    return () => { open(); close() }
  }, [store])
  return null
}
