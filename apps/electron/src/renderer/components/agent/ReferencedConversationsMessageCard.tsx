/**
 * ReferencedConversationsMessageCard — 消息内已引用会话小卡片
 *
 * 渲染在用户消息下方：
 * - 紧凑展示“已引用 N 个对话”
 * - 点击可展开查看被引用的对话清单（标题、快照/实时模式、估算 tokens）
 * - 支持跨工作区点击跳转至源会话
 * - 绝不在消息流中直接展开大段原文
 * - 数据基于消息持久化时的快照，不受后续增删引用影响
 */

import * as React from 'react'
import { MessageSquareText, ChevronDown, ChevronRight, ExternalLink, Camera, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOpenSession } from '@/hooks/useOpenSession'
import type { AgentContextRef } from '@gamma/shared'

export interface ReferencedConversationsMessageCardProps {
  refs?: AgentContextRef[]
}

export function ReferencedConversationsMessageCard({
  refs,
}: ReferencedConversationsMessageCardProps): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState(false)
  const openSession = useOpenSession()

  if (!refs || refs.length === 0) return null

  const handleJump = (ref: AgentContextRef, e: React.MouseEvent): void => {
    e.stopPropagation()
    openSession('agent', ref.sourceConversationId, ref.titleAtAttach || '引用会话')
  }

  return (
    <div className="mt-2 mb-1 rounded-md border border-border/60 bg-muted/30 overflow-hidden text-xs">
      {/* 头部摘要点击可展开/折叠 */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-muted/50 transition-colors select-none text-left"
      >
        <div className="flex items-center gap-1.5 text-muted-foreground/90">
          <MessageSquareText className="size-3.5 text-sky-500 shrink-0" />
          <span className="font-medium text-foreground/80">已引用 {refs.length} 个对话作为背景</span>
        </div>

        <div className="flex items-center gap-1 text-muted-foreground/50">
          <span className="text-[10px]">
            {expanded ? '收起' : '查看清单'}
          </span>
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </div>
      </button>

      {/* 展开的引用会话列表 */}
      {expanded && (
        <div className="px-2.5 pb-2 pt-1 border-t border-border/40 space-y-1.5 bg-background/50">
          {refs.map((ref) => {
            const isLive = ref.mode === 'live'

            return (
              <div
                key={ref.refId}
                onClick={(e) => handleJump(ref, e)}
                className="group flex items-center justify-between p-1.5 rounded hover:bg-muted/60 transition-colors cursor-pointer border border-transparent hover:border-border/60"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isLive ? (
                    <RefreshCw className="size-3 text-emerald-500 shrink-0" />
                  ) : (
                    <Camera className="size-3 text-sky-500 shrink-0" />
                  )}
                  <span className="truncate font-medium text-foreground group-hover:text-primary transition-colors">
                    {ref.titleAtAttach || '无标题会话'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    ({isLive ? '实时' : '快照'})
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-muted-foreground/60 group-hover:text-foreground">
                  {ref.estTokens != null && ref.estTokens > 0 && (
                    <span className="text-[10px] font-mono">
                      ~{ref.estTokens} tokens
                    </span>
                  )}
                  <ExternalLink className="size-3 opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
