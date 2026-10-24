/** 消息中的对话引用：与非图片文件附件相同的直接标签展示，使用发送时快照。 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MessageSquareText } from 'lucide-react'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { messageAttachmentClassName } from '@/components/session/attachment-styles'
import type { AgentContextRef } from '@gamma/shared'

export interface ReferencedConversationsMessageCardProps {
  refs?: AgentContextRef[]
}

export function ReferencedConversationsMessageCard({
  refs,
}: ReferencedConversationsMessageCardProps): React.ReactElement | null {
  const openSession = useOpenSession()
  const sessions = useAtomValue(agentSessionsAtom)
  if (!refs?.length) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-2" aria-label="引用对话附件">
      {refs.map((ref) => {
        const deleted = !sessions.some((session) => session.id === ref.sourceConversationId)
        const title = ref.titleAtAttach || '无标题会话'
        const mode = ref.mode === 'live' ? '实时' : '快照'
        return (
          <button
            key={ref.refId}
            type="button"
            disabled={deleted}
            onClick={() => openSession('agent', ref.sourceConversationId, title)}
            className={messageAttachmentClassName}
            title={`${title} · ${mode}${ref.estTokens ? ` · 约 ${ref.estTokens} tokens` : ''}${deleted ? ' · 源对话已删除' : ' · 打开源对话'}`}
          >
            <MessageSquareText className="size-3.5 shrink-0" />
            <span className="truncate max-w-[200px]">{title}</span>
            <span className="shrink-0 text-[10px] opacity-60">{deleted ? '源对话已删除' : mode}</span>
          </button>
        )
      })}
    </div>
  )
}
