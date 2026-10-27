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
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import {
  Popover,
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
  navRef?: React.RefObject<HTMLDivElement | null>
}

export function OnDemandOverlayPanel({
  sessionId,
  activeButtonRef,
  navRef,
}: OnDemandOverlayPanelProps): React.ReactElement | null {
  const [activeOverlay, setActiveOverlay] = useAtom(activeOnDemandOverlayAtom)
  const closeOverlay = useSetAtom(closeOnDemandOverlayAtom)
  const isBigPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)

  const isOpen = Boolean(activeOverlay) && !isBigPanelOpen

  // 全局 Escape 监听，确保任意组件焦点或 window 事件均可关闭浮层并回焦
  React.useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeOverlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeOverlay, isOpen])

  // 处理关闭回焦：如果已进入 S2，阻止回焦到 S0 图标
  const handleCloseAutoFocus = React.useCallback((event: Event) => {
    if (isBigPanelOpen) {
      event.preventDefault()
      return
    }
    if (activeButtonRef?.current) {
      event.preventDefault()
      activeButtonRef.current.focus()
    }
  }, [activeButtonRef, isBigPanelOpen])

  if (!isOpen) return null

  return (
    <PopoverContent
      align="end"
      side="bottom"
      sideOffset={6}
      collisionPadding={12}
      onCloseAutoFocus={handleCloseAutoFocus}
      onPointerDownOutside={(e) => {
        if (navRef?.current?.contains(e.target as Node)) {
          e.preventDefault()
        }
      }}
      onInteractOutside={(e) => {
        if (navRef?.current?.contains(e.target as Node)) {
          e.preventDefault()
        }
      }}
      role="dialog"
      aria-modal="false"
      aria-label="按需快捷面板"
      data-testid="on-demand-overlay-panel"
      data-active-overlay={activeOverlay ?? undefined}
      className={cn(
        'z-[45] flex w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0',
        'max-h-[70vh] rounded-[13px] border border-border/60 bg-popover text-popover-foreground shadow-xl outline-none',
        'duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
        'motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none',
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
