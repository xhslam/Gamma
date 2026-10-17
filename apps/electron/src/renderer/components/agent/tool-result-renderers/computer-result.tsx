/**
 * ComputerResultRenderer — 电脑桌面操作结果渲染器
 *
 * 中断时在聊天记录中显示一行说明；正常结果显示操作消息或折叠详细回执。
 */

import * as React from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { DefaultResultRenderer } from './default-result'

interface ComputerResultRendererProps {
  result: string
  isError: boolean
}

export function ComputerResultRenderer({ result, isError }: ComputerResultRendererProps): React.ReactElement {
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(result)
  } catch {
    // 纯文本
  }

  // 中断场景：显示一行醒目说明，不使用悬浮通知
  if (parsed?.interrupted === true) {
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '桌面操作已停止'
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">桌面操作已中断：{reason}</span>
      </div>
    )
  }

  if (parsed && typeof parsed.message === 'string') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span className="text-foreground/80">{parsed.message}</span>
      </div>
    )
  }

  return <DefaultResultRenderer result={result} isError={isError} />
}
