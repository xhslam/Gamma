import * as React from 'react'
import { ArrowDownIcon, CheckCircle2, CircleAlert, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { useConversationJumpVisible } from '@/components/ai-elements/conversation'
import { FadeTitle } from '@/components/ui/fade-title'

const FINISH_RETENTION_MS = 4_000
const FADE_OUT_DURATION_MS = 200

export interface ContextCompactionProgress {
  status: 'running' | 'success' | 'noop' | 'failed'
  label: string
  detail?: string
  summary?: string
}

interface TaskProgressOverlayProps {
  streaming: boolean
  contextCompaction?: ContextCompactionProgress
}

function compactionSignature(progress: ContextCompactionProgress): string {
  return `${progress.status}:${progress.label}:${progress.detail ?? ''}:${progress.summary ?? ''}`
}

export function shouldRestoreCompactionProgress(signature: string, dismissedSignature: string): boolean {
  return signature !== dismissedSignature
}

/** 压缩后同一个 stream 恢复工作时，短时终态反馈不能覆盖新的执行状态。 */
export function shouldClearRetainedCompactionForResumedStream(
  streaming: boolean,
  contextCompaction: ContextCompactionProgress | undefined,
  retainedCompaction: ContextCompactionProgress | undefined,
): boolean {
  return streaming && !contextCompaction && !!retainedCompaction
}

function CompactionProgressDetails({ progress }: { progress: ContextCompactionProgress }): React.ReactElement {
  const isRunning = progress.status === 'running'
  return (
    <div className="space-y-3 p-1">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          {isRunning && <Loader2 className="size-4 animate-spin text-info" />}
          {progress.status === 'success' && <CheckCircle2 className="size-4 text-success" />}
          {progress.status === 'noop' && <CheckCircle2 className="size-4 text-muted-foreground" />}
          {progress.status === 'failed' && <CircleAlert className="size-4 text-destructive" />}
        </span>
        <div className="min-w-0 space-y-1">
          <div className="text-[13px] font-medium text-foreground">{progress.label}</div>
          {progress.detail && <p className="text-xs text-muted-foreground">{progress.detail}</p>}
        </div>
      </div>
      {progress.summary && !isRunning && (
        <p className="max-h-28 overflow-y-auto rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-5 text-muted-foreground">{progress.summary}</p>
      )}
    </div>
  )
}

/** 计划已移入执行区；浮层仅保留既有的系统压缩反馈与跳至最新消息。 */
export function TaskProgressOverlay({ streaming, contextCompaction }: TaskProgressOverlayProps): React.ReactElement | null {
  const { scrollToBottom } = useStickToBottomContext()
  const showJump = useConversationJumpVisible()
  const jumpToLatest = (): void => {
    void scrollToBottom(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth')
  }
  const [retainedCompaction, setRetainedCompaction] = React.useState<ContextCompactionProgress>()
  const [retainedSignature, setRetainedSignature] = React.useState('')
  const [dismissedSignature, setDismissedSignature] = React.useState('')
  const [visible, setVisible] = React.useState(false)
  const [fading, setFading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const liveSignature = contextCompaction ? compactionSignature(contextCompaction) : ''

  React.useEffect(() => {
    if (!contextCompaction) return
    if (contextCompaction.status === 'running' && dismissedSignature) setDismissedSignature('')
    if (liveSignature === retainedSignature || !shouldRestoreCompactionProgress(liveSignature, dismissedSignature)) return
    setRetainedCompaction(contextCompaction)
    setRetainedSignature(liveSignature)
    setFading(false)
    setVisible(true)
  }, [contextCompaction, dismissedSignature, liveSignature, retainedSignature])

  React.useEffect(() => {
    if (!shouldClearRetainedCompactionForResumedStream(streaming, contextCompaction, retainedCompaction)) return
    setRetainedCompaction(undefined)
    setRetainedSignature('')
    setFading(false)
    setVisible(false)
    setOpen(false)
  }, [streaming, contextCompaction, retainedCompaction])

  const progress = contextCompaction ?? retainedCompaction
  const signature = progress ? compactionSignature(progress) : ''
  const hideKey = progress && progress.status !== 'running' && progress.status !== 'failed' ? `${signature}:${streaming}` : ''
  React.useEffect(() => {
    if (!hideKey) return
    const fadeTimer = window.setTimeout(() => setFading(true), FINISH_RETENTION_MS - FADE_OUT_DURATION_MS)
    const hideTimer = window.setTimeout(() => {
      setDismissedSignature(signature)
      setVisible(false)
      setOpen(false)
      setRetainedCompaction(undefined)
      setRetainedSignature('')
    }, FINISH_RETENTION_MS)
    return () => { window.clearTimeout(fadeTimer); window.clearTimeout(hideTimer) }
  }, [hideKey, signature])

  if ((!visible || !progress) && !showJump) return null
  if (!visible || !progress) {
    return (
      <Button data-icon-button="true"
        className="absolute bottom-[26px] left-1/2 size-10 -translate-x-1/2 rounded-md border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm transition-colors duration-200 hover:bg-accent/80"
        onClick={jumpToLatest} aria-label="跳至最新消息" title="跳至最新消息" type="button" variant="ghost"
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  }
  return (
    <div className={cn('pointer-events-none absolute bottom-[22px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 transition-opacity duration-200', fading && 'opacity-0')}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="pointer-events-auto flex min-h-10 max-w-[min(460px,calc(100vw-9rem))] items-center gap-2 rounded-md border border-border/60 bg-background/85 py-2 pr-3 pl-2.5 text-left shadow-sm backdrop-blur-sm transition-colors duration-200 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {progress.status === 'running' && <Loader2 className="size-3.5 shrink-0 animate-spin text-info" />}
            {progress.status === 'success' && <CheckCircle2 className="size-3.5 shrink-0 text-success" />}
            {progress.status === 'noop' && <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />}
            {progress.status === 'failed' && <CircleAlert className="size-3.5 shrink-0 text-destructive" />}
            <FadeTitle className="truncate text-[13px] text-foreground/90">{progress.label}</FadeTitle>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(420px,calc(100vw-2rem))] rounded-md border-border/60 bg-background/95 p-2 backdrop-blur-sm" side="top" align="center">
          <CompactionProgressDetails progress={progress} />
        </PopoverContent>
      </Popover>
      {showJump && (
        <Button data-icon-button="true" aria-label="回到最下方" className="pointer-events-auto size-10 rounded-md border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm transition-colors duration-200 hover:bg-accent/80" onClick={jumpToLatest} type="button" variant="ghost">
          <ArrowDownIcon className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
