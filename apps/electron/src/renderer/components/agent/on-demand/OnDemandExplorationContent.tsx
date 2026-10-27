/**
 * OnDemandExplorationContent — S1 动态调研按需浮层内容
 *
 * 严格对齐 SidePanel 与 AgentHeader 的动态分支生命周期：
 * - 优先展示当前已打开的活跃分支
 * - 携带真实 sourceMessageId / sourceLabel 恢复历史分支，严禁编造 fake 数据
 * - 支持键盘 ↑↓ 选择与 Enter 打开，直达 S2 大面板并切换到对应探索 Tab
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { GitBranch, Clock, ChevronRight, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  agentSessionsAtom,
  agentSideTemporaryAgentMapAtom,
  currentAgentSessionIdAtom,
  getExplorationSidePanelTab,
} from '@/atoms/agent-atoms'
import { openInBigPanelAtom } from '@/atoms/on-demand-panel-atoms'
import {
  deriveActiveExplorationBranches,
  deriveHistoricalExplorationBranches,
  canRestoreExplorationBranch,
  buildExplorationRestorePayload,
  type ExplorationBranchItem,
} from '@/lib/right-panel-exploration'
import type { AgentSessionMeta } from '@gamma/shared'

interface OnDemandExplorationContentProps {
  sessionId?: string
  onItemSelect?: () => void
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

export function OnDemandExplorationContent({
  sessionId: propSessionId,
  onItemSelect,
}: OnDemandExplorationContentProps): React.ReactElement {
  const currentId = useAtomValue(currentAgentSessionIdAtom) ?? ''
  const sessionId = propSessionId || currentId
  const sessions = useAtomValue(agentSessionsAtom)
  const sideTemporaryAgentMap = useAtomValue(agentSideTemporaryAgentMapAtom)
  const setSideTemporaryAgentMap = useSetAtom(agentSideTemporaryAgentMapAtom)
  const openInBigPanel = useSetAtom(openInBigPanelAtom)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    requestAnimationFrame(() => {
      containerRef.current?.focus()
    })
  }, [])

  // 1. 活跃调研分支
  const activeBranches = React.useMemo(
    () => deriveActiveExplorationBranches(sessionId, sideTemporaryAgentMap, sessions),
    [sessionId, sideTemporaryAgentMap, sessions],
  )

  const activeBranchIds = React.useMemo(
    () => new Set(activeBranches.map((b) => b.sessionId)),
    [activeBranches],
  )

  // 2. 历史可恢复调研分支
  const historicalBranches = React.useMemo(
    () => deriveHistoricalExplorationBranches(sessionId, sessions, activeBranchIds),
    [sessionId, sessions, activeBranchIds],
  )

  type DisplayItem =
    | { type: 'active'; branch: ExplorationBranchItem }
    | { type: 'historical'; session: AgentSessionMeta }

  const allItems = React.useMemo<DisplayItem[]>(() => {
    const list: DisplayItem[] = []
    for (const b of activeBranches) {
      list.push({ type: 'active', branch: b })
    }
    for (const s of historicalBranches) {
      list.push({ type: 'historical', session: s })
    }
    return list
  }, [activeBranches, historicalBranches])

  const [selectedIndex, setSelectedIndex] = React.useState<number>(0)

  // 打开活跃分支或恢复历史分支（必须携带真实元数据）
  const handleOpenItem = React.useCallback(
    (item: DisplayItem) => {
      if (item.type === 'active') {
        const branch = item.branch
        openInBigPanel({
          tab: getExplorationSidePanelTab(branch.sessionId),
          target: {
            branchSessionId: branch.sessionId,
            sourceMessageId: branch.sourceMessageId,
            sourceLabel: branch.sourceLabel,
          },
        })
        onItemSelect?.()
      } else {
        const hist = item.session
        const payload = buildExplorationRestorePayload(hist)
        if (!payload) return

        // 注入真实元数据到 sideTemporaryAgentMap
        setSideTemporaryAgentMap((prev) => {
          const current = prev.get(sessionId) ?? []
          if (current.some((b) => b.sessionId === hist.id)) return prev
          const next = new Map(prev)
          next.set(sessionId, [...current, payload])
          return next
        })

        openInBigPanel({
          tab: getExplorationSidePanelTab(hist.id),
          target: {
            branchSessionId: hist.id,
            sourceMessageId: payload.sourceMessageId,
            sourceLabel: payload.sourceLabel,
          },
        })
        onItemSelect?.()
      }
    },
    [onItemSelect, openInBigPanel, sessionId, setSideTemporaryAgentMap],
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (allItems.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(0, prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const target = allItems[selectedIndex]
        if (target) handleOpenItem(target)
      }
    },
    [allItems, handleOpenItem, selectedIndex],
  )

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="动态调研分支快捷面板"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2 text-xs">
        <span className="font-medium text-foreground">
          调研分支 ({activeBranches.length > 0 ? `${activeBranches.length} 活跃` : `${allItems.length}`})
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {allItems.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            暂无调研分支
          </div>
        ) : (
          <div className="space-y-0.5">
            {allItems.map((item, idx) => {
              const isSelected = idx === selectedIndex
              const isHistorical = item.type === 'historical'
              const title = isHistorical ? item.session.title : item.branch.title
              const sourceLabel = isHistorical
                ? item.session.explorationSourceLabel || '历史探索分支'
                : item.branch.sourceLabel
              const updatedAt = isHistorical ? item.session.updatedAt : item.branch.updatedAt
              const canRestore = isHistorical ? canRestoreExplorationBranch(item.session) : true

              return (
                <button
                  key={isHistorical ? `hist-${item.session.id}` : `act-${item.branch.sessionId}`}
                  type="button"
                  disabled={!canRestore}
                  onClick={() => handleOpenItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'group flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors',
                    isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60 text-muted-foreground',
                    !canRestore && 'opacity-50 cursor-not-allowed',
                  )}
                  role="option"
                  aria-selected={isSelected}
                >
                  {isHistorical ? (
                    <History className="size-3.5 shrink-0 text-muted-foreground/70" />
                  ) : (
                    <GitBranch className="size-3.5 shrink-0 text-primary/80" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center">
                    <span className="truncate font-medium text-foreground text-xs leading-tight">
                      {title}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground/70 leading-tight">
                      {sourceLabel}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/60 font-mono">
                    <Clock className="size-2.5" />
                    {formatRelativeTime(updatedAt)}
                  </span>
                  <ChevronRight className="size-3 text-muted-foreground/40 group-hover:text-foreground transition-transform shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
