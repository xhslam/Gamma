/**
 * on-demand-panel-atoms — 右侧按需面板 Jotai 状态
 *
 * 管理 S0 (默认收起)、S1 (按需轻量浮层) 与 S2 (既有大面板) 的状态协同。
 * S1 属于瞬时 UI 状态，不持久化；S2 保持既有持久化。
 */

import { atom } from 'jotai'
import type { AgentSidePanelTab } from '@/atoms/agent-atoms'
import {
  currentAgentSessionIdAtom,
  currentSessionSidePanelOpenAtom,
  agentSidePanelOpenAtomFamily,
  agentDiffPanelTabAtom,
  agentSideTemporaryAgentMapAtom,
  fileBrowserAutoRevealAtom,
  getExplorationSidePanelTab,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'
import { applyOpenPreview } from '@/components/diff/preview-opener'
import type { PreviewFile } from '@/atoms/preview-atoms'
import type { OnDemandOverlayTab, OnDemandState } from '@/lib/right-panel-state'
import { transitionRightPanelState } from '@/lib/right-panel-state'
import { activeOnDemandOverlayAtom, agentDiffStatusAtom } from './on-demand-base-atoms'
import type { DiffFetchStatus } from './on-demand-base-atoms'

// 重新导出，保持调用方 import 路径向后兼容
export { activeOnDemandOverlayAtom, agentDiffStatusAtom }
export type { DiffFetchStatus }

/** 派生当前会话的统一三状态 */
export const onDemandPanelStateAtom = atom<OnDemandState>((get) => {
  const isBigPanelOpen = get(currentSessionSidePanelOpenAtom)
  const activeOverlay = get(activeOnDemandOverlayAtom)
  const currentSessionId = get(currentAgentSessionIdAtom)
  const activeTab = (currentSessionId ? get(agentDiffPanelTabAtom).get(currentSessionId) : null) ?? 'files'

  return {
    isBigPanelOpen,
    activeOverlay,
    activeTab,
  }
})

/** 切换按需浮层 (S1) */
export const toggleOnDemandOverlayAtom = atom(
  null,
  (get, set, tab: OnDemandOverlayTab) => {
    const currentState = get(onDemandPanelStateAtom)
    const next = transitionRightPanelState(currentState, { type: 'TOGGLE_OVERLAY', tab })

    set(activeOnDemandOverlayAtom, next.activeOverlay)
    if (currentState.isBigPanelOpen !== next.isBigPanelOpen) {
      set(currentSessionSidePanelOpenAtom, next.isBigPanelOpen)
    }
  },
)

/** 关闭按需浮层 */
export const closeOnDemandOverlayAtom = atom(
  null,
  (_get, set) => {
    set(activeOnDemandOverlayAtom, null)
  },
)

export interface OpenInBigPanelParams {
  tab?: AgentSidePanelTab
  target?: string | PreviewFile | { branchSessionId: string; sourceMessageId?: string; sourceLabel?: string } | null
}

/**
 * 统一打开大面板入口 (S2)
 *
 * 1. 严格结束 S1，消除残留 activeOverlay 隐患
 * 2. 如果 target 为 PreviewFile，走统一预览身份/列表/活动 tab 状态机
 * 3. 如果 target 为调研分支，激活/恢复该探索分支并在大面板打开（使用真实元数据）
 * 4. 如果未指定具体 tab，保留并恢复既有 agentDiffPanelTabAtom（避免破坏用户正在阅读的内容）
 * 5. 展开大面板 (S2)
 */
export const openInBigPanelAtom = atom(
  null,
  (get, set, params?: OpenInBigPanelParams) => {
    const sessionId = get(currentAgentSessionIdAtom)
    if (!sessionId) return

    // 1. 关闭 S1
    set(activeOnDemandOverlayAtom, null)

    const tab = params?.tab
    const target = params?.target

    // 2. 处理 PreviewFile 目标（保留 sessionPath/dirPath/gitRoot/baseRef/readOnly/previewOnly）
    if (target && typeof target === 'object' && 'filePath' in target) {
      applyOpenPreview(set, sessionId, target as PreviewFile)
      return
    }

    // 3. 处理动态调研分支目标（使用真实元数据，禁止编造 fake id）
    if (target && typeof target === 'object' && 'branchSessionId' in target) {
      const branchSessionId = target.branchSessionId
      const explorationTab = getExplorationSidePanelTab(branchSessionId)
      const sessions = get(agentSessionsAtom)
      const branchSession = sessions.find((s) => s.id === branchSessionId)
      const sourceMessageId = target.sourceMessageId ?? branchSession?.explorationSourceMessageId
      const sourceLabel = target.sourceLabel ?? branchSession?.explorationSourceLabel ?? '主线探索节点'

      if (!sourceMessageId) {
        console.warn('[openInBigPanel] 探索分支缺失真实 sourceMessageId，不可恢复:', branchSessionId)
        return
      }

      set(agentSideTemporaryAgentMapAtom, (prev) => {
        const currentBranches = prev.get(sessionId) ?? []
        if (currentBranches.some((b) => b.sessionId === branchSessionId)) return prev
        const next = new Map(prev)
        next.set(sessionId, [
          ...currentBranches,
          {
            sessionId: branchSessionId,
            sourceMessageId,
            sourceLabel,
          },
        ])
        return next
      })
      set(agentDiffPanelTabAtom, (prev) => {
        const next = new Map(prev)
        next.set(sessionId, explorationTab)
        return next
      })
      set(agentSidePanelOpenAtomFamily(sessionId), true)
      set(currentSessionSidePanelOpenAtom, true)
      return
    }

    // 4. 处理字符串目标
    if (typeof target === 'string') {
      if (tab === 'changes') {
        const previewFile: PreviewFile = {
          filePath: target,
          previewOnly: true,
        }
        applyOpenPreview(set, sessionId, previewFile)
        return
      }
      set(fileBrowserAutoRevealAtom, {
        sessionId,
        path: target,
        ts: Date.now(),
        select: true,
      })
    }

    // 5. 恢复既有 Tab 或切换到目标 Tab
    const existingTab = get(agentDiffPanelTabAtom).get(sessionId)
    const targetTab = tab ?? existingTab ?? 'files'

    set(agentDiffPanelTabAtom, (previous) => {
      const next = new Map(previous)
      next.set(sessionId, targetTab)
      return next
    })

    // 6. 展开大面板
    set(agentSidePanelOpenAtomFamily(sessionId), true)
    set(currentSessionSidePanelOpenAtom, true)
  },
)
