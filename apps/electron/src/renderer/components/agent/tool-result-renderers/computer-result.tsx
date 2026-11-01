/**
 * ComputerResultRenderer — 电脑桌面操作结果渲染器
 *
 * 支持上游 agent-desktop command 命名、snapshot 元素树、
 * partial 截断状态、disposition 重试策略与中断展示。
 */

import * as React from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Layers, RefreshCw } from 'lucide-react'
import { DefaultResultRenderer } from './default-result'
import { CollapsibleResult } from './collapsible-result'

interface ComputerResultRendererProps {
  result: string
  isError: boolean
}

const COMMAND_LABELS: Record<string, string> = {
  snapshot: '抓取元素树', find: '查找控件', screenshot: '截取屏幕',
  get: '读取属性', is: '检查状态', click: '点击', 'double-click': '双击',
  'triple-click': '三击', 'right-click': '右键点击', type: '输入文字',
  'set-value': '填写控件', clear: '清空控件', focus: '聚焦控件',
  select: '选择文字', toggle: '切换状态', check: '勾选', uncheck: '取消勾选',
  expand: '展开', collapse: '折叠', scroll: '滚动', 'scroll-to': '滚动到控件',
  press: '按键', hover: '悬停', drag: '拖动', 'mouse-move': '移动指针',
  'mouse-click': '鼠标点击', 'mouse-wheel': '鼠标滚轮', launch: '打开应用',
  'close-app': '关闭应用', 'list-windows': '查看窗口', 'list-displays': '查看显示器',
  'list-apps': '查看应用', 'focus-window': '切换窗口', 'resize-window': '调整窗口',
  'move-window': '移动窗口', minimize: '最小化窗口', maximize: '最大化窗口',
  restore: '还原窗口', 'list-surfaces': '查看界面', 'open-system-surface': '打开系统界面',
  'list-notifications': '查看通知', 'dismiss-notification': '忽略通知',
  'dismiss-all-notifications': '清除所有通知', 'notification-action': '点击通知操作',
  'clipboard-get': '读取剪贴板', 'clipboard-set': '写入剪贴板', 'clipboard-clear': '清空剪贴板',
  wait: '等待', status: '查询状态', permissions: '查询权限', version: '查询版本',
  skills: '查询技能', session: '会话管理', 'cursor-overlay': '光标指示', trace: '追踪调试',
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
      <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning dark:text-warning">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">桌面操作已中断：{reason}</span>
      </div>
    )
  }

  if (parsed && (typeof parsed.command === 'string' || typeof parsed.message === 'string' || typeof parsed.summary === 'string')) {
    const command = typeof parsed.command === 'string' ? parsed.command : undefined
    const commandLabel = command ? (COMMAND_LABELS[command] ?? command) : null
    const isSuccess = parsed.ok !== false && !isError
    const isPartial = parsed.complete === false
    const disposition = parsed.disposition as { retry?: string; delivery?: string } | undefined
    const canRetry = disposition?.retry === 'safe'
    const imageAttached = parsed.imageAttached === true
    const summary = typeof parsed.summary === 'string'
      ? parsed.summary
      : typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : isSuccess ? '操作已完成' : '操作未完成'

    const hasData = parsed.data !== undefined && parsed.data !== null

    return (
      <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-2.5 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {isSuccess ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-success dark:text-success" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-3.5 shrink-0 text-warning dark:text-warning" aria-hidden="true" />
          )}

          {commandLabel && (
            <span className="rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
              {commandLabel}
            </span>
          )}

          {isPartial && (
            <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning dark:text-warning">
              <Layers className="size-3" aria-hidden="true" />
              部分元素树 (截断)
            </span>
          )}

          {canRetry && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <RefreshCw className="size-2.5" aria-hidden="true" />
              可安全重试
            </span>
          )}

          {imageAttached && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              已附屏幕截图
            </span>
          )}

          <span className="text-foreground/80">{summary}</span>
        </div>

        {hasData && (
          <details className="group mt-1 text-[11px]">
            <summary className="cursor-pointer select-none text-muted-foreground/80 hover:text-foreground">
              查看回执详情
            </summary>
            <div className="mt-1.5 max-h-60 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] text-foreground/80 border border-border/30">
              <pre className="whitespace-pre-wrap break-all">
                {typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data, null, 2)}
              </pre>
            </div>
          </details>
        )}
      </div>
    )
  }

  return <DefaultResultRenderer result={result} isError={isError} />
}
