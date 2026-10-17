import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, ChevronDown, Loader2, Monitor, Pause, ShieldCheck, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ComputerRiskPolicy } from '@gamma/shared'
import {
  computerUsePanelOpenAtom,
  computerUseViewAtom,
  refreshComputerUseAtom,
  selectComputerSessionAtom,
  stopComputerUseAtom,
} from '@/atoms/computer-use'
import { getComputerStatusLabel, hasComputerControl } from './computer-use-model'

export interface ComputerUsePanelProps {
  sessionId: string | null
}

/** 只展示状态并提供独立停止入口，Agent 自行选择何时使用桌面工具。 */
export function ComputerUsePanel({ sessionId }: ComputerUsePanelProps): React.ReactElement {
  const [open, setOpen] = useAtom(computerUsePanelOpenAtom)
  const view = useAtomValue(computerUseViewAtom)
  const selectSession = useSetAtom(selectComputerSessionAtom)
  const refresh = useSetAtom(refreshComputerUseAtom)
  const stop = useSetAtom(stopComputerUseAtom)
  const [policy, setPolicy] = React.useState<ComputerRiskPolicy>('standard')
  const titleId = React.useId()
  const descriptionId = React.useId()

  React.useEffect(() => { void selectSession(sessionId) }, [sessionId, selectSession])
  React.useEffect(() => window.electronAPI.onComputerStateChanged(() => { void refresh() }), [refresh])
  React.useEffect(() => {
    window.electronAPI.getComputerPreferences().then((p) => {
      if (p?.riskPolicy) setPolicy(p.riskPolicy)
    }).catch(() => {})
  }, [open])

  const changePolicy = async (newPolicy: ComputerRiskPolicy) => {
    setPolicy(newPolicy)
    try {
      await window.electronAPI.updateComputerPreferences({ riskPolicy: newPolicy })
    } catch {}
  }

  const state = view.state
  const stopping = view.pending === 'stop' || state?.phase === 'stopping'
  const statusLabel = getComputerStatusLabel(view)
  const controlling = hasComputerControl(state)
  const otherSession = controlling && state?.sessionId && state.sessionId !== sessionId
  const waiting = state?.phase === 'authorizing' || state?.pendingAction !== undefined
  const StatusIcon = view.error || state?.phase === 'error' ? AlertCircle
    : state?.phase === 'paused' ? Pause : waiting ? ShieldCheck : Monitor
  const targetApp = controlling ? state?.targetApp?.name : undefined

  return (
    <div className="titlebar-no-drag inline-flex max-w-[calc(100vw-2rem)] items-center gap-2" aria-label="桌面操作状态与停止">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-64" aria-label={`查看桌面状态：${statusLabel}`}>
            {view.loading || stopping ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <StatusIcon aria-hidden="true" className="text-muted-foreground" />}
            <span className="truncate" role="status" aria-live="polite">{targetApp ? `${statusLabel} · ${targetApp}` : statusLabel}</span>
            <ChevronDown className="text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto p-4"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-medium">桌面操作</h2>
              <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">直接描述任务，Agent 会在需要时操作 App。</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="收起桌面状态" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </Button>
          </div>

          <div className="my-4 rounded-md bg-muted/50 p-3 text-sm leading-relaxed">
            <p className="font-medium">{statusLabel}</p>
            {targetApp && <p className="mt-1 break-words text-foreground">{targetApp}</p>}
            {state?.message && <p className="mt-1 break-words text-xs text-muted-foreground">{state.message}</p>}
            {otherSession && <p className="mt-2 text-xs text-muted-foreground">另一个会话正在使用桌面。这里的停止按钮同样有效。</p>}
            {waiting && <p className="mt-2 text-xs text-muted-foreground">请在系统或 App 授权窗口中确认后继续。</p>}
            {state?.phase === 'paused' && <p className="mt-2 text-xs text-muted-foreground">需要继续时，在会话中告诉 Agent。</p>}
            {state?.phase === 'unsupported' && <p className="mt-2 text-xs text-muted-foreground">桌面操作需要 macOS 14.2 或更新版本。</p>}
          </div>

          <div className="my-3 space-y-1.5 border-t border-border/40 pt-3">
            <div className="flex items-center justify-between text-xs font-medium text-foreground">
              <span>确认策略</span>
              <span className="text-[11px] text-muted-foreground">
                {policy === 'strict' ? '高低风险均确认' : policy === 'standard' ? '拦截高风险与凭据' : '仅拦截破坏性操作'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
              {(['strict', 'standard', 'relaxed'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void changePolicy(p)}
                  className={cn(
                    'rounded-md py-1 text-xs font-medium transition-colors',
                    policy === p
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p === 'strict' ? '严格' : p === 'standard' ? '标准' : '宽松'}
                </button>
              ))}
            </div>
          </div>

          {view.error && <p role="alert" className="mb-4 break-words rounded-md bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">{view.error}</p>}

          <p className="text-xs leading-relaxed text-muted-foreground">动键鼠即可暂停。发送、支付、删除和提交等操作会先请你确认。</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">快捷停止 <kbd className="whitespace-nowrap font-sans text-foreground">⌃ ⌥ Esc</kbd></span>
            <Button type="button" size="sm" variant="ghost" disabled={view.loading || stopping} onClick={() => { void refresh() }}>
              {view.loading && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
              {view.error ? '重试读取' : '刷新状态'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button" variant="outline" size="sm" className="shrink-0"
        disabled={view.pending === 'stop'}
        aria-label="停止所有会话的桌面操作"
        onClick={() => { void stop() }}
      >
        {view.pending === 'stop' ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Square aria-hidden="true" />}
        {view.pending === 'stop' ? '正在停止' : '停止'}
      </Button>
    </div>
  )
}
