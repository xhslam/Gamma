/**
 * OnDemandOverlayPanel — S1 按需轻量浮层容器
 *
 * 基于 Radix Popover 原语：
 * - 紧贴图标组右对齐，距离视口边缘保留 12px 边距防溢出 (collisionPadding={12})
 * - 宽 380px、高至 70vh、z-[45]（高于聊天内容、低于系统模态框 z-[100]）
 * - 原位切换：在不同 tab 间切换保留同一 Anchor，避免重新展开闪烁
 * - 焦点自管理：打开聚焦内容，Esc / 点击外部 / 再次点击关闭并平滑回焦
 * - 切至 S2 时禁止夺焦；120–160ms 淡入微动，reduced-motion 禁用动画
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import {
  PopoverContent,
} from '@/components/ui/popover'
import {
  currentSessionSidePanelOpenAtom,
} from '@/atoms/agent-atoms'
import {
  activeOnDemandOverlayAtom,
  closeOnDemandOverlayAtom,
} from '@/atoms/on-demand-panel-atoms'
import { OnDemandFilesContent } from './OnDemandFilesContent'
import { OnDemandChangesContent } from './OnDemandChangesContent'
import { OnDemandExplorationContent } from './OnDemandExplorationContent'

interface OnDemandOverlayPanelProps {
  sessionId: string
  activeButtonRef?: React.RefObject<HTMLButtonElement | null>
}

export function OnDemandOverlayPanel({
  sessionId,
  activeButtonRef,
}: OnDemandOverlayPanelProps): React.ReactElement | null {
  const activeOverlay = useAtomValue(activeOnDemandOverlayAtom)
  const closeOverlay = useSetAtom(closeOnDemandOverlayAtom)
  const isBigPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)

  const isOpen = Boolean(activeOverlay) && !isBigPanelOpen

  // 任意焦点位置或 window 级 Escape 都能关闭浮层并回焦。
  React.useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeOverlay()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeOverlay, isOpen])

  // 处理关闭回焦：如果已进入 S2，阻止回焦到 S0 图标
  const handleCloseAutoFocus = React.useCallback((event: Event) => {
    if (isBigPanelOpen || !activeButtonRef?.current?.isConnected) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    activeButtonRef.current.focus()
  }, [activeButtonRef, isBigPanelOpen])

  if (!isOpen) return null

  return (
    <PopoverContent
      align="end"
      side="bottom"
      sideOffset={6}
      collisionPadding={12}
      onCloseAutoFocus={handleCloseAutoFocus}
      role="dialog"
      aria-modal="false"
      aria-label="按需快捷面板"
      data-testid="on-demand-overlay-panel"
      data-active-overlay={activeOverlay ?? undefined}
      className={cn(
        'gamma-on-demand-panel z-[45] flex w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden',
        'max-h-[70vh] text-popover-foreground outline-none',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeOverlay === 'files' && (
          <OnDemandFilesContent sessionId={sessionId} onItemSelect={closeOverlay} />
        )}
        {activeOverlay === 'changes' && (
          <OnDemandChangesContent sessionId={sessionId} onItemSelect={closeOverlay} />
        )}
        {activeOverlay === 'exploration' && (
          <OnDemandExplorationContent sessionId={sessionId} onItemSelect={closeOverlay} />
        )}
      </div>
    </PopoverContent>
  )
}
