import { useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { activeOnDemandOverlayAtom } from '@/atoms/on-demand-panel-atoms'
import { OnDemandOverlayPanel } from './OnDemandOverlayPanel'

interface OnDemandConversationLayoutProps {
  sessionId: string
  embedded?: boolean
  children: ReactNode
}

/** 消息与输入区共享剩余宽度；退出动效结束后再卸载侧栏内容。 */
export function OnDemandConversationLayout({ sessionId, embedded = false, children }: OnDemandConversationLayoutProps): React.ReactElement {
  const activeOverlay = useAtomValue(activeOnDemandOverlayAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const eligible = !embedded && currentSessionId === sessionId
  const open = eligible && activeOverlay !== null
  const [retained, setRetained] = useState({ sessionId, tab: open ? activeOverlay : null })
  const tab = open ? activeOverlay : retained.sessionId === sessionId ? retained.tab : null

  useLayoutEffect(() => {
    if (open) {
      setRetained({ sessionId, tab: activeOverlay })
      return
    }
    // 切换会话或嵌入视图不保留旧会话；减少动态效果时也不延迟卸载。
    if (!eligible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRetained({ sessionId, tab: null })
      return
    }
    // transitionend 之外的兜底：后台窗口或系统改动画偏好时仍能释放内容。
    const timer = window.setTimeout(() => setRetained({ sessionId, tab: null }), 360)
    return () => window.clearTimeout(timer)
  }, [open, eligible, activeOverlay, sessionId])

  return (
    <div
      data-testid="on-demand-conversation-layout"
      data-panel-open={open}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="conversation-layout-main">{children}</div>
      <div
        className="gamma-on-demand-slot"
        data-state={open ? 'open' : 'closed'}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'width' && !open) {
            setRetained({ sessionId, tab: null })
          }
        }}
      >
        {eligible && tab && <OnDemandOverlayPanel sessionId={sessionId} activeOverlay={tab} open={open} />}
      </div>
    </div>
  )
}
