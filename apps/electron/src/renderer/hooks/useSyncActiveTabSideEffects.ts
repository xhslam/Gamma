/**
 * 标签切换与关闭时同步 Agent 会话、工作区和未读状态。
 */

import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import type { TabItem } from '@/atoms/tab-atoms'

export type SyncActiveTabSideEffects = (newActiveTab: TabItem | null) => void

export function useSyncActiveTabSideEffects(): SyncActiveTabSideEffects {
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)

  return useCallback<SyncActiveTabSideEffects>(
    (newActiveTab) => {
      if (!newActiveTab) {
        // 所有标签都已关闭

        setCurrentAgentSessionId(null)
        return
      }

      // Agent / 会话预览

      setCurrentAgentSessionId(newActiveTab.sessionId)

      // 清除该会话的"已完成未查看"标记
      setUnviewedCompleted((prev) => {
        if (!prev.has(newActiveTab.sessionId)) return prev
        const next = new Set(prev)
        next.delete(newActiveTab.sessionId)
        return next
      })

      // 同步 workspace
      const session = agentSessions.find((s) => s.id === newActiveTab.sessionId)
      if (session?.workspaceId) {
        setCurrentAgentWorkspaceId(session.workspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: session.workspaceId,
        }).catch(console.error)
      }
    },
    [
      setCurrentAgentSessionId,
      setCurrentAgentWorkspaceId,
      setUnviewedCompleted,
      agentSessions,
    ],
  )
}
