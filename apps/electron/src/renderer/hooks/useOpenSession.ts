/**
 * 打开或聚焦 Agent 会话，恢复文件预览并同步项目和设置导航 guard。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  openTab,
  buildOpenTabRestore,
  sessionViewStateMapAtom,
} from '@/atoms/tab-atoms'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { automationFormAtom } from '@/atoms/automation-atoms'
import {
  currentAgentSessionIdAtom,
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import {
  channelFormDirtyAtom,
  settingsOpenAtom,
  settingsPendingSessionNavigationAtom,
} from '@/atoms/settings-tab'

interface OpenSessionOptions {
  bypassSettingsGuard?: boolean
  /** 仅在导航实际执行后调用；设置 Guard 取消时不会调用。 */
  onOpened?: () => void
}

type OpenSessionFn = (type: 'agent', sessionId: string, title: string, options?: OpenSessionOptions) => void

export function useOpenSession(): OpenSessionFn {
  const store = useStore()
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const channelFormDirty = useAtomValue(channelFormDirtyAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setPendingSessionNavigation = useSetAtom(settingsPendingSessionNavigationAtom)

  return React.useCallback(
    (type: 'agent', sessionId: string, title: string, options?: OpenSessionOptions): void => {
      if (!options?.bypassSettingsGuard && settingsOpen && channelFormDirty) {
        setPendingSessionNavigation({ type, sessionId, title, onOpened: options?.onOpened })
        return
      }
      setSettingsOpen(false)

      // 切回 agent 会话时，若该会话上次开着预览 Tab 则一并重建并回到上次视图
      const restore = buildOpenTabRestore(
        sessionId,
        store.get(sessionViewStateMapAtom),
        store.get(previewFileMapAtom),
      )
      const result = openTab(tabs, { type, sessionId, title }, restore)
      setTabs(result.tabs)
      setActiveTabId(result.activeTabId)
      setAutomationForm({ open: false, draft: null })
      setActiveView('conversations')

      setCurrentAgentSessionId(sessionId)

      // 用户打开查看后只清除未读角标；是否完成由用户通过对勾确认。
      setUnviewedCompleted((prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })

      // 同步 workspaceId，确保与 TabBar 切换行为一致
      const session = agentSessions.find((s) => s.id === sessionId)
      if (session?.workspaceId) {
        setCurrentAgentWorkspaceId(session.workspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: session.workspaceId,
        }).catch(console.error)
      }
      options?.onOpened?.()
    },
    [tabs, setTabs, setActiveTabId, setAutomationForm, setActiveView, setCurrentAgentSessionId, agentSessions, setCurrentAgentWorkspaceId, setUnviewedCompleted, settingsOpen, channelFormDirty, setSettingsOpen, setPendingSessionNavigation],
  )
}
