import * as React from 'react'
import { useAtomValue, useStore } from 'jotai'
import {
  agentDiffPanelTabAtom,
  agentTerminalTabsAtom,
  currentAgentSessionIdAtom,
  currentSessionSidePanelOpenAtom,
  getTerminalSidePanelTab,
} from '@/atoms/agent-atoms'
import { projectAgyTerminalsAtom } from '@/atoms/project-agy-terminal-atoms'
import { retainTerminalViews } from './TerminalTabContent'

/** 必须与 AppShell 同生命周期，不能随 Agent 面板或 设置/规划/Skills 页面切换卸载。 */
export function TerminalLifecycleObserver(): null {
  const store = useStore()
  const tabs = useAtomValue(agentTerminalTabsAtom)
  const projectTerminals = useAtomValue(projectAgyTerminalsAtom)
  React.useEffect(() => {
    const retained = new Map<string, readonly { terminalId: string; cwd?: string; existingOnly?: boolean }[]>(tabs)
    for (const entry of projectTerminals.values()) {
      if (entry.terminal) retained.set(entry.terminal.ownerId, [{ ...entry.terminal, existingOnly: true }])
    }
    retainTerminalViews(retained)
  }, [tabs, projectTerminals])
  React.useEffect(() => {
    const close = window.electronAPI.onAgentTerminalClose((event) => {
      store.set(projectAgyTerminalsAtom, (previous) => {
        const next = new Map(previous)
        for (const [id, entry] of previous) {
          if (entry.terminal?.terminalId === event.terminalId) next.set(id, { accepted: entry.accepted, status: 'closed' })
        }
        return next
      })
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
    const exit = window.electronAPI.onTerminalExit((event) => {
      store.set(projectAgyTerminalsAtom, (previous) => {
        const match = [...previous].find(([, entry]) => entry.terminal?.terminalId === event.terminalId)
        if (!match?.[1].terminal) return previous
        return new Map(previous).set(match[0], { ...match[1], terminal: { ...match[1].terminal, exitCode: event.exitCode } })
      })
    })
    return () => { open(); close(); exit() }
  }, [store])
  return null
}
