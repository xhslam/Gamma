/**
 * useOpenPreview — 统一的预览入口 Hook
 *
 * 把分散在 SidePanel / PreviewOpenButton / AgentView 等处的「打开预览」逻辑收敛到一处。
 * 文件、Markdown 与 Diff 一律在右侧工作区的预览 Tab 打开，不再占用主内容区。
 */

import * as React from 'react'
import type { WritableAtom } from 'jotai'
import { useStore } from 'jotai'
import {
  getPreviewFileId,
  previewFileMapAtom,
  previewFilesMapAtom,
  previewPanelOpenMapAtom,
  type PreviewFile,
} from '@/atoms/preview-atoms'
import {
  activeTabIdAtom,
  closeTab,
  isPreviewTab,
  sessionViewStateMapAtom,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily, getPreviewSidePanelTab } from '@/atoms/agent-atoms'
import { activeOnDemandOverlayAtom } from '@/atoms/on-demand-base-atoms'

/** Jotai store 类型（从 useStore 推导，避免直接 import 内部 Store 类型） */
type JotaiStore = ReturnType<typeof useStore>

export type JotaiSetter = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...args: Args
) => Result

/** 兼容旧调用方；右侧工作区方案下不再使用 mode。 */
export interface OpenPreviewOptions {
  mode?: 'tab' | 'split'
}

/**
 * 核心预览打开状态应用：供 store 与 atom write 统一调用。
 *
 * 保证：
 * 1. 同一预览身份再次打开时保留 Tab 顺序，但采用最新权限、根目录与解析上下文。
 * 2. 激活并展开大面板 (S2)。
 * 3. 自动关闭 S1 浮层，保证 S1/S2 互斥且不留幽灵状态。
 */
export function applyOpenPreview(
  set: JotaiSetter,
  sessionId: string,
  file: PreviewFile,
): void {
  const previewId = getPreviewFileId(file)
  set(previewFilesMapAtom, (prev) => {
    const next = new Map(prev)
    const files = next.get(sessionId) ?? []
    const existingIndex = files.findIndex((item) => getPreviewFileId(item) === previewId)
    next.set(
      sessionId,
      existingIndex === -1
        ? [...files, file]
        : files.map((item, index) => (index === existingIndex ? file : item)),
    )
    return next
  })
  set(previewFileMapAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, file)
    return next
  })
  set(previewPanelOpenMapAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, true)
    return next
  })
  set(agentSidePanelOpenAtomFamily(sessionId), true)
  set(agentDiffPanelTabAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, getPreviewSidePanelTab(previewId))
    return next
  })
  set(activeOnDemandOverlayAtom, null)
}

/**
 * 在指定会话的右侧工作区中打开并聚焦文件预览。
 *
 * 供 React Hook 和 IPC 事件处理器共同复用，保证计划审批等外部事件不会绕过预览 Tab 的状态约定。
 */
export function openPreviewInStore(store: JotaiStore, sessionId: string, file: PreviewFile): void {
  applyOpenPreview(store.set.bind(store), sessionId, file)
}

export function useOpenPreview() {
  const store = useStore()

  return React.useCallback(
    (sessionId: string, file: PreviewFile, _options?: OpenPreviewOptions) => {
      openPreviewInStore(store, sessionId, file)
    },
    [store],
  )
}

/**
 * tearOffPreviewToSplit — 兼容旧 preview Tab：将其迁入右侧工作区预览。
 *
 * 保留此导出供旧的拖拽和预览 Tab 操作调用；新预览不会再创建主内容区 Tab。
 */
export function tearOffPreviewToSplit(store: JotaiStore, tabId: string): void {
  const tabs = store.get(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab || !isPreviewTab(tab)) return

  const sessionId = tab.sessionId

  const agentTab = tabs.find((t) => t.type === 'agent' && t.sessionId === sessionId)
  if (!agentTab) return

  // 关闭旧 preview Tab，并激活对应 Agent 会话，让右侧工作区可见
  const closed = closeTab(store.get(tabsAtom), store.get(activeTabIdAtom), tabId)
  store.set(tabsAtom, closed.tabs)
  store.set(activeTabIdAtom, agentTab.id)

  // 标记会话视图为 session，避免切走再切回时重建 preview Tab
  store.set(sessionViewStateMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, { previewTabOpen: false, lastView: 'session' })
    return m
  })

  store.set(previewPanelOpenMapAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, true)
    return next
  })
  store.set(agentSidePanelOpenAtomFamily(sessionId), true)
  store.set(agentDiffPanelTabAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, 'preview')
    return next
  })
  store.set(activeOnDemandOverlayAtom, null)
}
