/** 按需快捷侧栏：历史组件名保留兼容，实际在会话布局内占位，不使用 Portal。 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { activeOnDemandOverlayAtom, closeOnDemandOverlayAtom } from '@/atoms/on-demand-panel-atoms'
import { OnDemandFilesContent } from './OnDemandFilesContent'
import { OnDemandChangesContent } from './OnDemandChangesContent'
import { OnDemandExplorationContent } from './OnDemandExplorationContent'

interface OnDemandOverlayPanelProps { sessionId: string }
const labels = { files: '文件', changes: '改动', exploration: '调研' }

export function OnDemandOverlayPanel({ sessionId }: OnDemandOverlayPanelProps): React.ReactElement | null {
  const activeOverlay = useAtomValue(activeOnDemandOverlayAtom)
  const closeOverlay = useSetAtom(closeOnDemandOverlayAtom)
  const panelRef = React.useRef<HTMLElement>(null)
  const selectionClosesPanel = React.useRef(false)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  // 切换标签时更新回焦目标，但不重新挂载布局或抢走内容区域焦点。
  React.useLayoutEffect(() => {
    const nav = panelRef.current?.closest('[data-agent-conversation-root]')?.querySelector('[data-testid="on-demand-right-panel-nav"]')
      ?? document.querySelector('[data-testid="on-demand-right-panel-nav"]')
    returnFocusRef.current = nav?.querySelector<HTMLElement>(`button[data-active="true"]`) ?? null
  }, [activeOverlay])

  React.useEffect(() => {
    const panel = panelRef.current
    // 与此前搜索浮层一致，打开后可直接键入；不设焦点陷阱，对话仍能操作。
    const firstControl = panel?.querySelector<HTMLElement>('input, [role="option"], button:not([data-panel-close])')
    ;(firstControl ?? panel)?.focus({ preventScroll: true })
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeOverlay()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      // 点击具体文件时由大预览接管焦点，不抢回入口。
      if (!selectionClosesPanel.current && returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
    }
  }, [closeOverlay])

  const handleItemSelect = React.useCallback(() => {
    selectionClosesPanel.current = true
    closeOverlay()
  }, [closeOverlay])
  if (!activeOverlay) return null

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={`${labels[activeOverlay]}快捷侧栏`}
      data-testid="on-demand-overlay-panel"
      data-active-overlay={activeOverlay}
      data-presentation="docked"
      data-panel="quick-sidebar"
      className="gamma-panel my-3 mr-3 flex min-h-0 min-w-0 w-[clamp(12rem,30%,22rem)] max-w-[45%] shrink-0 flex-col overflow-hidden text-foreground outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="text-sm font-medium text-muted-foreground">{labels[activeOverlay]}</span>
        <Button data-icon-button="true" data-panel-close="" type="button" variant="ghost" size="icon" className="size-7" aria-label="关闭快捷侧栏" onClick={() => closeOverlay()}><X className="size-4" /></Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeOverlay === 'files' && <OnDemandFilesContent sessionId={sessionId} onItemSelect={handleItemSelect} />}
        {activeOverlay === 'changes' && <OnDemandChangesContent sessionId={sessionId} onItemSelect={handleItemSelect} />}
        {activeOverlay === 'exploration' && <OnDemandExplorationContent sessionId={sessionId} onItemSelect={handleItemSelect} />}
      </div>
    </aside>
  )
}
