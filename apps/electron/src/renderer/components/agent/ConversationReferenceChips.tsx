/**
 * ConversationReferenceChips — 输入框上方会话引用 Chip 条
 *
 * 展示当前会话已附加的引用会话 Chips：
 * - 标题 + 估算 tokens
 * - 模式标签（快照 / 实时），支持单击快速切换
 * - 单独 x 按钮移除
 * - 源对话被删除时显示灰度警告态与提示
 * - 源对话被重命名时实时展示最新标题，并在 Tooltip 中展示原标题
 * - 超出 Token 预算时下方展示黄色温和提示：“部分引用将以摘要形式提供”，不阻止发送
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MessageSquareText, X, AlertTriangle, RefreshCw, Camera, Plus, Trash2, ArrowRightLeft } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { composerAttachmentClassName, attachmentRemoveClassName } from '@/components/session/attachment-styles'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import {
  DEFAULT_BUDGET_TOKENS,
  ABSOLUTE_TIER_A_TOKEN_LIMIT,
  MAX_CONTEXT_REFS,
  type AgentContextRef,
  type ReferenceSummaryStatus,
  type ReferenceSummaryProgress,
} from '@gamma/shared'
import { FadeTitle } from '@/components/ui/fade-title'

export interface ConversationReferenceChipsProps {
  embedded?: boolean
  sessionId?: string
  /** 当前会话激活的渠道 ID（用于跨渠道引用检测） */
  currentChannelId?: string | null
  refs: AgentContextRef[]
  onRemoveRef: (refId: string) => void
  onToggleMode: (refId: string) => void
  onOpenSelector?: () => void
  /** 当前模型是否处于可能需要摘要的超预算状态 */
  isOverBudget?: boolean
  /** 最大预算 Token 常量（用于提示，默认 DEFAULT_BUDGET_TOKENS） */
  maxBudgetTokens?: number
}

export function ConversationReferenceChips({
  embedded = false,
  sessionId,
  currentChannelId,
  refs,
  onRemoveRef,
  onToggleMode,
  onOpenSelector,
  isOverBudget,
  maxBudgetTokens = DEFAULT_BUDGET_TOKENS,
}: ConversationReferenceChipsProps): React.ReactElement | null {
  const agentSessions = useAtomValue(agentSessionsAtom)
  const [summaryStatuses, setSummaryStatuses] = React.useState<Record<string, ReferenceSummaryStatus>>({})
  const [summaryProgresses, setSummaryProgresses] = React.useState<Record<string, ReferenceSummaryProgress>>({})
  const refKey = refs.map((ref) => ref.refId).join(',')

  // 跨渠道引用提示：每引用/目标路由提示一次“内容将发送给当前渠道的模型”（不是每轮 poll 重复）
  const notifiedCrossChannelRefsRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    if (!currentChannelId || refs.length === 0) return
    for (const ref of refs) {
      const source = agentSessions.find((s) => s.id === ref.sourceConversationId)
      if (source?.channelId && source.channelId !== currentChannelId) {
        const routeKey = `${ref.refId}:${currentChannelId}`
        if (!notifiedCrossChannelRefsRef.current.has(routeKey)) {
          notifiedCrossChannelRefsRef.current.add(routeKey)
          toast.info('内容将发送给当前渠道的模型', { id: `cross-channel-${ref.refId}` })
        }
      }
    }
  }, [refs, currentChannelId, agentSessions])
  React.useEffect(() => {
    if (!sessionId || !refKey) return
    let disposed = false
    let pending = false
    const poll = async (): Promise<void> => {
      if (pending) return
      pending = true
      try {
        const result = await window.electronAPI.getContextRefs({ sessionId })
        if (!disposed) {
          setSummaryStatuses(result.summaryStatuses ?? {})
          setSummaryProgresses(result.summaryProgresses ?? {})
        }
      } catch {
        // 状态请求失败不阻止输入或发送，下次轮询自动恢复。
      } finally { pending = false }
    }
    setSummaryStatuses({})
    void poll()
    const timer = setInterval(() => void poll(), 2_000)
    return () => { disposed = true; clearInterval(timer) }
  }, [sessionId, refKey])

  if (refs.length === 0) return null

  // 总估算 Tokens
  const totalTokens = refs.reduce((acc, r) => acc + (r.estTokens ?? 0), 0)
  // 超预算警告：仅由 token 总量超预算或 isOverBudget 触发，不再由引用数触发（Item 1 修复）
  const effectiveBudget = Math.min(maxBudgetTokens, ABSOLUTE_TIER_A_TOKEN_LIMIT)
  const shouldShowSummaryWarning = isOverBudget || totalTokens > effectiveBudget

  return (
    <div className={embedded ? "contents" : "flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-1.5"} data-conversation-attachments>
      {refs.map((ref) => {
        const isLive = ref.mode === 'live'
        const sourceSession = agentSessions.find((s) => s.id === ref.sourceConversationId)
        const isDeleted = !sourceSession
        const isRenamed = Boolean(sourceSession && sourceSession.title && sourceSession.title !== ref.titleAtAttach)
        const sourceChannelId = sourceSession?.channelId
        const isCrossChannel = Boolean(sourceChannelId && currentChannelId && sourceChannelId !== currentChannelId)
        const displayTitle = sourceSession?.title || ref.titleAtAttach || '无标题会话'

        return (
          <div
            key={ref.refId}
            className={cn(
              composerAttachmentClassName,
              !isDeleted && (ref.estTokens ?? 0) > effectiveBudget / Math.max(1, refs.length) && 'text-warning border-warning/50',
              isDeleted
                ? 'text-muted-foreground border-dashed border-destructive/30 opacity-80'
                : ''
            )}
          >
            <MessageSquareText className="size-4 shrink-0" />
            {/* 模式切换小图标/按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onToggleMode(ref.refId)}
                  disabled={isDeleted}
                  aria-label={`切换引用模式：${displayTitle}`}
                  className={cn(
                    'flex items-center gap-0.5 text-[10px] px-1 rounded transition-colors',
                    isDeleted
                      ? 'text-muted-foreground/50 cursor-not-allowed'
                      : isLive
                        ? 'text-success dark:text-success hover:bg-success/10'
                        : 'text-info dark:text-info hover:bg-info/10'
                  )}
                >
                  {isDeleted ? (
                    <Trash2 className="size-2.5 text-destructive/70" />
                  ) : isLive ? (
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
                <p>
                  {isDeleted
                    ? '源对话已删除。本次发送将提示该引用不可用，可手动移除。'
                    : isLive
                      ? '实时模式：每轮读取源会话最新消息（点击切换为快照）'
                      : '快照模式：冻结在引用时的消息状态（点击切换为实时）'}
                </p>
              </TooltipContent>
            </Tooltip>

            {/* 标题 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <FadeTitle
                  className={cn(
                    'max-w-[160px] truncate text-[13px]',
                    isDeleted ? 'line-through text-muted-foreground' : 'text-foreground/90'
                  )}
                >
                  {displayTitle}
                </FadeTitle>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isRenamed && <p>原标题：{ref.titleAtAttach}</p>}
                {isCrossChannel && (
                  <p className="text-warning font-medium">内容将发送给当前渠道的模型</p>
                )}
              </TooltipContent>
            </Tooltip>

            {/* 跨渠道提示图标 */}
            {isCrossChannel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="flex items-center text-warning hover:text-warning transition-colors cursor-help"
                    data-testid="cross-channel-indicator"
                    aria-label="内容将发送给当前渠道的模型"
                  >
                    <ArrowRightLeft className="size-2.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>内容将发送给当前渠道的模型</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* 已删除标签 */}
            {isDeleted && (
              <span className="text-[10px] text-destructive/80 font-normal">
                源对话已删除
              </span>
            )}

            {!isDeleted && sessionId && (
              <span className="text-[10px] text-muted-foreground" role="status">
                {(() => {
                  const status = summaryStatuses[ref.refId]
                  if (status === 'ready') return '已就绪'
                  if (status === 'fallback') return '失败回退'
                  const progress = summaryProgresses[ref.refId]
                  if (progress && progress.total > 0) {
                    return `摘要中 ${progress.completed}/${progress.total}`
                  }
                  if (typeof status === 'string' && status.startsWith('running:')) {
                    return `摘要中 ${status.slice('running:'.length)}`
                  }
                  return '摘要中'
                })()}
              </span>
            )}

            {/* Token 估算 */}
            {ref.estTokens != null && ref.estTokens > 0 && (
              <span className="text-[10px] text-muted-foreground/50 font-mono">
                ~{ref.estTokens >= 1000 ? `${(ref.estTokens / 1000).toFixed(1)}k` : ref.estTokens}t
              </span>
            )}

            {/* 删除按钮 */}
            <button data-icon-button="true"
              type="button"
              onClick={() => onRemoveRef(ref.refId)}
              className={attachmentRemoveClassName}
              aria-label={`移除引用 ${displayTitle}`}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}

      {/* 快捷增添按钮 */}
      {refs.length < MAX_CONTEXT_REFS && onOpenSelector && (
        <button
          type="button"
          onClick={onOpenSelector}
          className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground border border-dashed border-border/80 hover:border-border transition-colors"
        >
          <Plus className="size-3" />
          <span>添加</span>
        </button>
      )}

      {/* 跨渠道提示 */}
      {refs.some((r) => {
        const s = agentSessions.find((sess) => sess.id === r.sourceConversationId)
        return Boolean(s?.channelId && currentChannelId && s.channelId !== currentChannelId)
      }) && (
        <div
          className="basis-full flex items-center gap-1 text-[11px] text-warning/90 dark:text-warning/90"
          data-testid="cross-channel-notice"
        >
          <ArrowRightLeft className="size-3 shrink-0" />
          <span>内容将发送给当前渠道的模型</span>
        </div>
      )}

      {/* 超出预算提示 */}
      {shouldShowSummaryWarning && (
        <div className="basis-full flex items-center gap-1 text-[11px] text-warning/90 dark:text-warning/90">
          <AlertTriangle className="size-3 shrink-0" />
          <span>引用内容较多，部分对话将由模型提炼结构化摘要注入（不影响正常发送）。</span>
        </div>
      )}
    </div>
  )
}
