import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Loader2, Monitor, Square, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  computerUseViewAtom,
  stopComputerUseAtom,
  resumeComputerUseAtom,
  refreshComputerUseAtom,
} from '@/atoms/computer-use'
import {
  hasComputerControl,
  getComputerStatusLabel,
} from './computer-use-model'

export interface ComputerUseStatusProps {
  sessionId?: string | null
}

/**
 * 桌面操作状态与停止入口：
 * 在应用内展示真实可见的活动状态与立即停止/恢复入口。
 */
export function ComputerUseStatus(props: ComputerUseStatusProps): React.ReactElement | null {
  const view = useAtomValue(computerUseViewAtom)
  const stop = useSetAtom(stopComputerUseAtom)
  const resume = useSetAtom(resumeComputerUseAtom)
  const refresh = useSetAtom(refreshComputerUseAtom)

  React.useEffect(() => {
    void refresh()
  }, [props.sessionId, refresh])

  if (!hasComputerControl(view.state)) {
    return null
  }

  const phase = view.state?.phase
  const isStopping = view.pending === 'stop' || phase === 'stopping'
  const isPaused = phase === 'paused' || view.state?.resumeRequired === true
  const appName = view.state?.targetApp?.name
  const label = getComputerStatusLabel(view)

  return (
    <aside
      aria-label="电脑桌面操作运行状态"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-border/80 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {phase === 'active' || isStopping ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Monitor className="size-4" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 max-w-[200px]">
        <div className="flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${
              isPaused
                ? 'bg-warning'
                : phase === 'active'
                  ? 'bg-success animate-pulse'
                  : 'bg-muted-foreground'
            }`}
            aria-hidden="true"
          />
          <span className="truncate text-xs font-medium text-foreground">
            {appName ? `${appName} · ` : ''}{label}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {view.state?.message || 'agent-desktop'}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {isPaused && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-xl px-2.5 text-xs"
            onClick={() => void resume()}
            disabled={view.pending === 'resume'}
          >
            <Play className="size-3 fill-current" aria-hidden="true" />
            继续
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          className="h-7 gap-1 rounded-xl px-2.5 text-xs shadow-none"
          onClick={() => void stop()}
          disabled={isStopping}
        >
          {isStopping ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Square className="size-3 fill-current" aria-hidden="true" />
          )}
          停止
        </Button>
      </div>
    </aside>
  )
}
