/**
 * 无标签时恢复当前项目 Agent 草稿或最近会话；必要时创建隐藏草稿。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import { currentAgentWorkspaceIdAtom, agentSettingsReadyAtom } from '@/atoms/agent-atoms'
import { tabsAtom, activeTabIdAtom, openTab } from '@/atoms/tab-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

export function WelcomeView(): React.ReactElement {
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentSettingsReady = useAtomValue(agentSettingsReadyAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const { createAgent } = useCreateSession()
  const initRef = React.useRef(false)

  // 将高频变化的值收集到 ref 中，避免污染 useEffect 依赖数组（否则 tabs/draftSessionIds
  // 引用变化会导致重复触发，而 createAgent 每次渲染都是新引用）
  const latestRef = React.useRef({
    tabs,
    draftSessionIds,
    currentWorkspaceId,
    setTabs,
    setActiveTabId,
    createAgent,
  })
  latestRef.current = {
    tabs,
    draftSessionIds,
    currentWorkspaceId,
    setTabs,
    setActiveTabId,
    createAgent,
  }

  React.useEffect(() => {
    // 如果已经为当前视图初始化过，则跳过
    if (initRef.current) return
    // Agent 模式需等待 settings 就绪（workspaceId 等异步加载完成）
    if (!agentSettingsReady) return

    initRef.current = true
    let cancelled = false

    // 从后端 IPC 拿最新数据，避免 HMR 导致 atoms 重置为空时重复创建会话
    {
      window.electronAPI.listActiveAgentSessions().then((freshSessions) => {
        // 如果视图已卸载，丢弃过期回调
        if (cancelled) return
        const {
          tabs: currentTabs,
          draftSessionIds: currentDrafts,
          currentWorkspaceId: currentWs,
          setTabs: currentSetTabs,
          setActiveTabId: currentSetActiveTabId,
          createAgent: currentCreateAgent,
        } = latestRef.current

        // Agent 模式：按当前工作区过滤。持久化草稿在侧栏中无入口，必须优先恢复，
        // 否则同项目的普通会话会让草稿永久不可访问。
        const draftSession = freshSessions.find(
          (s) => !s.archived && s.workspaceId === currentWs && (s.isDraft || currentDrafts.has(s.id)),
        )
        if (draftSession) {
          const result = openTab(currentTabs, {
            type: 'agent',
            sessionId: draftSession.id,
            title: draftSession.title,
          })
          currentSetTabs(result.tabs)
          currentSetActiveTabId(result.activeTabId)
          return
        }
        // 没有草稿时，复用现有普通会话。
        const existing = freshSessions.find(
          (s) => !s.archived && s.workspaceId === currentWs && !s.isDraft && !currentDrafts.has(s.id),
        )
        if (existing) {
          const result = openTab(currentTabs, {
            type: 'agent',
            sessionId: existing.id,
            title: existing.title,
          })
          currentSetTabs(result.tabs)
          currentSetActiveTabId(result.activeTabId)
          return
        }
        // 没有任何会话时才创建新的 draft 会话
        currentCreateAgent({ draft: true })
      }).catch(console.error)
    }
    return () => { cancelled = true; initRef.current = false }
  }, [agentSettingsReady])

  // 短暂的过渡状态（通常几十毫秒内就会被 TabContent 替换）
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
    </div>
  )
}
