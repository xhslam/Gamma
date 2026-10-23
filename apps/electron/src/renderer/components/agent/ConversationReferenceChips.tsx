/**
 * ConversationReferenceChips — 输入框上方会话引用 Chip 条
 *
 * 展示当前会话已附加的引用会话 Chips：
 * - 标题 + 估算 tokens
 * - 模式标签（快照 / 实时），支持单击快速切换
 * - 单独 x 按钮移除
 * - 源对话被删除时显示灰度警告态
 * - 超出预算（>3条或估算超过阈值）时下方展示黄色温和提示：“部分引用将以摘要形式提供”，不阻止发送
 */

import * as React from 'react'
import { MessageSquareText, X, AlertTriangle, Sparkles, RefreshCw, Camera, Plus } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentContextRef } from '@gamma/shared'

export interface ConversationReferenceChipsProps {
  refs: AgentContextRef[]
  onRemoveRef: (refId: string) => void
  onToggleMode: (refId: string) => void
  onOpenSelector?: () => void
  /** 当前模型是否处于可能需要摘要的超预算或高引用状态 */
  isOverBudget?: boolean
}

export function ConversationReferenceChips({
  refs,
  onRemoveRef,
  onToggleMode,
  onOpenSelector,
  isOverBudget,
}: ConversationReferenceChipsProps): React.ReactElement | null {
  if (refs.length === 0) return null

  // 总估算 Tokens
  const totalTokens = refs.reduce((acc, r) => acc + (r.estTokens ?? 0), 0)
  const shouldShowSummaryWarning = isOverBudget || refs.length > 3

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2 pb-1 border-b border-border/30">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground/70 flex items-center gap-1 mr-1">
          <MessageSquareText className="size-3 text-sky-500" />
          <span>引用对话 ({refs.length}/5):</span>
        </span>

        {refs.map((ref) => {
          const isLive = ref.mode === 'live'

          return (
            <div
              key={ref.refId}
              className={cn(
                'group inline-flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md text-xs border transition-all',
                'bg-background/80 hover:bg-muted/60 border-border/70 shadow-xs'
              )}
            >
              {/* 模式切换小图标/按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onToggleMode(ref.refId)}
                    className={cn(
                      'flex items-center gap-0.5 text-[10px] px-1 rounded transition-colors',
                      isLive
                        ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                        : 'text-sky-600 dark:text-sky-400 hover:bg-sky-500/10'
                    )}
                  >
                    {isLive ? (
                      <>
                        <RefreshCw className="size-2.5" />
                        <span>实时</span>
                      </>
                    ) : (
                      <>
                        <Camera className="size-2.5" />
                        <span>快照</span>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{isLive ? '实时模式：每轮读取源会话最新消息（点击切换为快照）' : '快照模式：冻结在引用时的消息状态（点击切换为实时）'}</p>
                </TooltipContent>
              </Tooltip>

              {/* 标题 */}
              <span className="max-w-[140px] truncate text-[11px] font-medium text-foreground/90">
                {ref.titleAtAttach || '无标题会话'}
              </span>

              {/* Token 估算 */}
              {ref.estTokens != null && ref.estTokens > 0 && (
                <span className="text-[10px] text-muted-foreground/50 font-mono">
                  ~{ref.estTokens >= 1000 ? `${(ref.estTokens / 1000).toFixed(1)}k` : ref.estTokens}t
                </span>
              )}

              {/* 删除按钮 */}
              <button
                type="button"
                onClick={() => onRemoveRef(ref.refId)}
                className="size-4 rounded-full flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/80 transition-colors"
                aria-label={`移除引用 ${ref.titleAtAttach}`}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}

        {/* 快捷增添按钮 */}
        {refs.length < 5 && onOpenSelector && (
          <button
            type="button"
            onClick={onOpenSelector}
            className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground border border-dashed border-border/80 hover:border-border transition-colors"
          >
            <Plus className="size-3" />
            <span>添加</span>
          </button>
        )}
      </div>

      {/* 超出预算提示 */}
      {shouldShowSummaryWarning && (
        <div className="flex items-center gap-1 text-[11px] text-amber-600/90 dark:text-amber-400/90">
          <AlertTriangle className="size-3 shrink-0" />
          <span>引用内容较多，部分对话将由模型提炼结构化摘要注入（不影响正常发送）。</span>
        </div>
      )}
    </div>
  )
}
