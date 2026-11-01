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

/** 消息与输入区共享剩余宽度；快捷侧栏是布局列，不覆盖会话。 */
export function OnDemandConversationLayout({ sessionId, embedded = false, children }: OnDemandConversationLayoutProps): React.ReactElement {
  const activeOverlay = useAtomValue(activeOnDemandOverlayAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const open = !embedded && currentSessionId === sessionId && activeOverlay !== null
  return (
    <div
      data-testid="on-demand-conversation-layout"
      data-panel-open={open}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="conversation-layout-main">{children}</div>
      {open && <OnDemandOverlayPanel sessionId={sessionId} />}
    </div>
  )
}
