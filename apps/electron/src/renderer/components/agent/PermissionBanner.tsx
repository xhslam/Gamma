/**
 * PermissionBanner — Agent 权限请求横幅
 *
 * 内联在 Agent 对话流底部，当有待处理的权限请求时显示。
 * 显示工具名、命令内容、危险等级，提供允许/拒绝/总是允许操作。
 * 支持队列模式：多个并发请求按 FIFO 逐个展示。
 *
 * 设计参考 Craft Agents OSS 的内联权限 UI。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Shield, ShieldAlert, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import { getToolExecutionPresentation } from '@/lib/tool-execution-presentation'
import { isImeKeyboardEvent } from '@/lib/ime-keyboard-policy'
import type { DangerLevel } from '@gamma/shared'

/** 危险等级对应的图标颜色 */
const DANGER_ICON_STYLES: Record<DangerLevel, string> = {
  safe: 'text-success',
  normal: 'text-primary',
  dangerous: 'text-warning',
}

/** 解析工具显示名称（MCP 工具显示 server / tool） */
function formatToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

/** PermissionBanner 属性接口 */
interface PermissionBannerProps {
  sessionId: string
}

export function PermissionBanner({ sessionId }: PermissionBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(allPendingPermissionRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [responding, setResponding] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const dismissingRef = React.useRef(false)
  const inFlightRef = React.useRef(false)
  const composingRef = React.useRef(false)
  const [submissionError, setSubmissionError] = React.useState<{ requestId: string; message: string } | null>(null)
  const request = requests[0] ?? null

  /** 关闭权限请求 & 终止 Agent */
  const handleDismiss = async (): Promise<void> => {
    if (!request || dismissingRef.current || inFlightRef.current) return
    dismissingRef.current = true
    setStopping(true)
    setSubmissionError(null)
    const requestIds = new Set(requests.map((pending) => pending.requestId))
    try {
      await window.electronAPI.stopAgent(sessionId)
      // 停止 IPC 失败时不得隐藏审批或伪造停止；晚到响应也不能删除新的请求。
      setAllRequests((prev) => {
        const map = new Map(prev)
        const remaining = (map.get(sessionId) ?? []).filter((pending) => !requestIds.has(pending.requestId))
        if (remaining.length) map.set(sessionId, remaining)
        else map.delete(sessionId)
        return map
      })
    } catch (error) {
      console.error('[PermissionBanner] 终止失败:', error)
      setSubmissionError({ requestId: request.requestId, message: '终止 Agent 失败，请重试。审批请求仍保留。' })
    } finally {
      dismissingRef.current = false
      setStopping(false)
    }
  }

  if (!request) return null

  const iconColor = DANGER_ICON_STYLES[request.dangerLevel]
  const isDangerous = request.dangerLevel === 'dangerous'
  const IconComponent = isDangerous ? ShieldAlert : Shield

  /** 响应权限请求 */
  const respond = async (behavior: 'allow' | 'deny', alwaysAllow = false): Promise<void> => {
    if (inFlightRef.current || dismissingRef.current) return
    inFlightRef.current = true
    setResponding(true)
    setSubmissionError(null)

    try {
      await window.electronAPI.respondPermission({
        requestId: request.requestId,
        behavior,
        alwaysAllow,
      })
      // 移除已响应的请求（FIFO 出队）
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[PermissionBanner] 响应失败:', error)
      setSubmissionError({ requestId: request.requestId, message: '审批提交失败，请检查连接后重试。请求仍保留，尚未确认授权。' })
    } finally {
      inFlightRef.current = false
      setResponding(false)
    }
  }

  return (
    <div
      role="region"
      aria-label="工具权限审批"
      aria-busy={responding || stopping}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' && isImeKeyboardEvent(event.nativeEvent, composingRef.current)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      className="mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <IconComponent className={`size-4 ${iconColor}`} />
          <span className="text-sm font-medium">
            {isDangerous ? '危险操作需要确认' : '需要确认'}
          </span>
          {requests.length > 1 && (
            <span className="text-xs text-muted-foreground">
              (+{requests.length - 1})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-mono">
            {request.sdkDisplayName ?? formatToolName(request.toolName)}
          </span>
          <button data-icon-button="true"
            type="button"
            className="size-5 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
            onClick={() => void handleDismiss()}
            disabled={responding || stopping}
            title="关闭并终止 Agent"
            aria-label="关闭并终止 Agent"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 命令/操作内容 */}
      <div className="px-3 pb-2 space-y-1.5">
        {/* SDK 可读标题（优先展示，描述操作意图） */}
        {request.sdkTitle && (
          <p className="text-xs text-foreground">{request.sdkTitle}</p>
        )}
        {/* SDK 详细描述（与标题不同时才展示） */}
        {request.sdkDescription && request.sdkDescription !== request.sdkTitle && (
          <p className="text-xs text-muted-foreground">{request.sdkDescription}</p>
        )}
        {/* Bash 命令：始终展示代码块 */}
        {request.command ? (
          <pre className="text-xs font-mono bg-background/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
            {request.command}
          </pre>
        ) : !request.sdkTitle && Object.keys(request.toolInput).length > 0 ? (
          <pre className="text-xs font-mono bg-background/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
            {JSON.stringify(request.toolInput, null, 2)}
          </pre>
        ) : !request.sdkTitle ? (
          <p className="text-xs text-muted-foreground">
            {request.description}
          </p>
        ) : null}
      </div>

      <div className="px-3 pb-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        {stopping ? '正在终止 Agent…' : `${getToolExecutionPresentation({ approval: responding ? 'submitting' : 'pending' }).label}；尚未收到工具执行结果。`}
      </div>
      {submissionError?.requestId === request.requestId && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">{submissionError.message}</p>
      )}
      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5">
        <span className="text-[10px] text-muted-foreground/40 mr-auto">
          聚焦按钮后按 Enter 确认
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => respond('deny')}
          disabled={responding || stopping}
          className="h-7 px-3 text-xs text-muted-foreground hover:text-destructive"
        >
          <X className="size-3 mr-1" />
          拒绝
        </Button>

        {request.allowAlways !== false && <Button
          variant="outline"
          size="sm"
          onClick={() => respond('allow', true)}
          disabled={responding || stopping}
          className="h-7 px-3 text-xs"
        >
          本次会话总是允许
        </Button>}

        <Button
          variant="default"
          size="sm"
          onClick={() => respond('allow')}
          disabled={responding || stopping}
          className="h-7 px-3 text-xs"
        >
          <Check className="size-3 mr-1" />
          允许
        </Button>
      </div>
    </div>
  )
}
