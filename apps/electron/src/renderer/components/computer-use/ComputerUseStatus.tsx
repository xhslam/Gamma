import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, Loader2, Monitor, Pause, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  computerUseViewAtom,
  refreshComputerUseAtom,
  selectComputerSessionAtom,
  stopComputerUseAtom,
} from '@/atoms/computer-use'
import { getComputerStatusLabel, hasComputerControl } from './computer-use-model'

export interface ComputerUseStatusProps {
  sessionId: string | null
}

/** 独立于侧栏与设置页存活；只有停止入口，不提供工具模式开关。 */
export function ComputerUseStatus({ sessionId }: ComputerUseStatusProps): React.ReactElement {
  const view = useAtomValue(computerUseViewAtom)
  const selectSession = useSetAtom(selectComputerSessionAtom)
  const refresh = useSetAtom(refreshComputerUseAtom)
  const stop = useSetAtom(stopComputerUseAtom)

  // 先建立监听再读取初始状态，避免初始化期间漏掉状态事件。
  React.useEffect(() => window.electronAPI.onComputerStateChanged(() => { void refresh() }), [refresh])
  React.useEffect(() => { void selectSession(sessionId) }, [sessionId, selectSession])

  const state = view.state
  const stopping = view.pending === 'stop' || state?.phase === 'stopping'
  const statusLabel = getComputerStatusLabel(view)
  const controlling = hasComputerControl(state)
  const targetApp = controlling ? state?.targetApp?.name : undefined
  const otherSession = controlling && state?.sessionId && state.sessionId !== sessionId
  const paused = state?.phase === 'paused' || state?.resumeRequired
  const StatusIcon = view.error || state?.phase === 'error' ? AlertCircle
    : state?.phase === 'paused' ? Pause : Monitor

  return (
    <div
      className="titlebar-no-drag absolute bottom-3 right-3 z-[70] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-sm"
      aria-label="桌面操作状态与停止"
    >
      {stopping || view.loading
        ? <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        : <StatusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0 max-w-64 text-xs">
        <p role="status" aria-live="polite" className="truncate" title={state?.message}>
          {targetApp ? `${statusLabel} · ${targetApp}` : statusLabel}
        </p>
        {state?.message && <p className="truncate text-[11px] text-muted-foreground" title={state.message}>{state.message}</p>}
        {otherSession && <p className="text-[11px] text-muted-foreground">另一个会话正在使用桌面，仍可停止。</p>}
        {paused && <p className="text-[11px] text-muted-foreground">发送新消息“继续”或新任务以恢复，不会重放旧动作。</p>}
        {view.error && <p role="alert" className="max-w-64 break-words text-[11px] text-destructive">{view.error}</p>}
      </div>
      <Button
        type="button" variant="ghost" size="icon-sm" className="shrink-0"
        disabled={stopping}
        aria-label="停止所有会话的桌面操作" title="停止桌面操作（⌃⌥Esc）"
        onClick={() => { void stop() }}
      >
        <Square aria-hidden="true" />
      </Button>
    </div>
  )
}
