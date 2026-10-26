/**
 * ExitPlanModeBanner — Agent ExitPlanMode 计划审批横幅
 *
 * 仿照 Claude Code 的计划审批 UI，提供 3 个选项：
 * 1. 批准并完全自动执行 — 切换到 bypassPermissions
 * 2. 拒绝计划 — deny
 * 3. 提供反馈 — 自由输入修改意见
 *
 * 键盘：聚焦选项后 ↑↓ 导航，Enter/Space 确认；快捷键不跨横幅响应。
 */

import * as React from 'react'
import { isImeKeyboardEvent } from '@/lib/ime-keyboard-policy'
import { handleBannerNavigation } from '@/lib/agent-control-keyboard'
import { useAtom, useSetAtom } from 'jotai'
import {
  Check,
  X,
  MessageSquare,
  Send,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { allPendingExitPlanRequestsAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import type { ExitPlanModeAction, ExitPlanAllowedPrompt } from '@gamma/shared'

/** 选项定义 */
interface PlanOption {
  action: ExitPlanModeAction
  label: string
  description: string
  icon: React.ReactNode
  variant: 'default' | 'secondary' | 'destructive'
}

const PLAN_OPTIONS: PlanOption[] = [
  {
    action: 'approve_bypass',
    label: '批准并完全自动执行',
    description: '后续工具调用全部自动允许',
    icon: <Check className="size-3.5" />,
    variant: 'default',
  },
  {
    action: 'deny',
    label: '拒绝计划',
    description: '直接拒绝，Agent 不会执行计划',
    icon: <X className="size-3.5" />,
    variant: 'destructive',
  },
  {
    action: 'feedback',
    label: '提供修改意见',
    description: '告诉 Agent 需要调整什么',
    icon: <MessageSquare className="size-3.5" />,
    variant: 'secondary',
  },
]

interface ExitPlanModeBannerProps {
  sessionId: string
}

export function ExitPlanModeBanner({ sessionId }: ExitPlanModeBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(allPendingExitPlanRequestsAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const openPreview = useOpenPreview()
  const requests = allRequests.get(sessionId) ?? []
  const [focusedIdx, setFocusedIdx] = React.useState(0)
  const [showFeedback, setShowFeedback] = React.useState(false)
  const [feedbackText, setFeedbackText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const request = requests[0] ?? null

  const submittingRef = React.useRef(false)
  const composingRef = React.useRef(false)
  const [submissionError, setSubmissionError] = React.useState<{ requestId: string; message: string } | null>(null)

  // 重置状态
  React.useEffect(() => {
    setFocusedIdx(0)
    setShowFeedback(false)
    setFeedbackText('')
    setSubmissionError(null)
  }, [request?.requestId])

  const handleAction = async (action: ExitPlanModeAction): Promise<void> => {
    if (submittingRef.current || !request) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmissionError(null)
    try {
      await window.electronAPI.respondExitPlanMode({
        requestId: request.requestId,
        action,
        feedback: action === 'feedback' ? feedbackText.trim() : undefined,
      })
      // 从队列移除
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[ExitPlanModeBanner] 响应失败:', error)
      setSubmissionError({ requestId: request.requestId, message: '计划审批提交失败，请重试。尚未确认授权。' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  /** 关闭计划审批 & 终止 Agent */
  const handleOpenPlanDocument = React.useCallback((): void => {
    if (!request?.planDocument) return
    openPreview(sessionId, {
      filePath: request.planDocument.filePath,
      previewOnly: true,
      readOnly: true,
    })
  }, [openPreview, request?.planDocument, sessionId])

  const handleDismiss = (): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
      })
      return map
    })
    setAllRequests((prev) => {
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }

  if (!request) return null

  return (
    <div
      role="region"
      aria-label="计划审批"
      aria-busy={submitting}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onKeyDownCapture={(event) => handleBannerNavigation(event, composingRef.current)}
      className="mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground flex-1">Agent 计划待审批</span>
          {request.planDocument && (
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={handleOpenPlanDocument}
              title={`在右侧查看 ${request.planDocument.displayName}`}
            >
              <FileText className="size-3.5" />
              查看计划
            </button>
          )}
          <button data-icon-button="true"
            type="button"
            className="size-5 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
            onClick={handleDismiss}
            title="关闭并终止 Agent"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Agent 已完成计划，请选择如何继续
        </p>
      </div>

      {/* allowedPrompts 展示 */}
      {request.allowedPrompts.length > 0 && (
        <AllowedPromptsList prompts={request.allowedPrompts} />
      )}

      {/* 选项列表 */}
      <div className="px-4 pb-2">
        <div className="flex flex-col gap-1">
          {PLAN_OPTIONS.map((option, idx) => {
            const isFocused = focusedIdx === idx
            return (
              <button
                key={option.action}
                data-banner-option=""
                onFocus={() => setFocusedIdx(idx)}
                type="button"
                className={`
                  flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring text-left
                  ${option.variant === 'destructive'
                    ? 'bg-muted/50 text-foreground/80 hover:bg-destructive/10 hover:text-destructive'
                    : 'bg-muted/50 text-foreground/80 hover:bg-muted'
                  }
                  ${isFocused ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card' : ''}
                `}
                onClick={() => {
                  if (option.action === 'feedback') {
                    setShowFeedback(true)
                  } else {
                    void handleAction(option.action)
                  }
                }}
                disabled={submitting}
              >
                <span className="text-[10px] shrink-0 text-muted-foreground/50">
                  {idx + 1}
                </span>
                <span className="shrink-0 text-muted-foreground/70">{option.icon}</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 反馈输入框 */}
      {showFeedback && (
        <div className="px-4 pb-2">
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 rounded-lg text-xs bg-muted/40 focus:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40 transition-colors"
              placeholder="输入修改意见..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isImeKeyboardEvent(e.nativeEvent)) {
                  e.preventDefault()
                  e.stopPropagation()
                  if (feedbackText.trim()) {
                    void handleAction('feedback')
                  }
                }
              }}
              autoFocus
              disabled={submitting}
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleAction('feedback')}
              disabled={submitting || !feedbackText.trim()}
              className="h-8 px-3 text-xs shrink-0"
            >
              <Send className="size-3 mr-1" />
              发送
            </Button>
          </div>
        </div>
      )}

      {submissionError?.requestId === request.requestId && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{submissionError.message}</p>}
      {/* 底部提示 */}
      <div className="flex items-center px-4 pb-3">
        <span className="text-[10px] text-muted-foreground/40">
          聚焦选项后 ↑↓ 导航 · Enter 确认
        </span>
      </div>
    </div>
  )
}

/** allowedPrompts 展示列表 */
function AllowedPromptsList({ prompts }: { prompts: ExitPlanAllowedPrompt[] }): React.ReactElement {
  return (
    <div className="px-4 pb-2">
      <p className="text-[11px] text-muted-foreground mb-1">计划需要的权限：</p>
      <div className="flex flex-wrap gap-1">
        {prompts.map((p, idx) => (
          <span
            key={idx}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/80"
          >
            {p.prompt}
          </span>
        ))}
      </div>
    </div>
  )
}
