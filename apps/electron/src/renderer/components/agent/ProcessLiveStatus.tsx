import * as React from 'react'
import { formatProcessElapsed } from './process-live-status'
import type { ProcessLiveStatus as LiveStatus } from './process-live-status'

interface ProcessLiveStatusProps {
  status: LiveStatus
  streaming: boolean
  startedAt?: number
  durationMs?: number
  children: React.ReactNode
}

/** 时间只来自真实 run 起点或终态耗时；没有时间证据的历史记录不补造计时。 */
export function ProcessLiveStatus({ status, streaming, startedAt, durationMs, children }: ProcessLiveStatusProps): React.ReactElement {
  const [mountedAt] = React.useState(Date.now)
  const [now, setNow] = React.useState(Date.now)
  const lastElapsedRef = React.useRef<number>()
  const previousLabelRef = React.useRef(status.label)
  const [outgoingLabel, setOutgoingLabel] = React.useState<string>()
  const start = startedAt != null && Number.isFinite(startedAt) ? startedAt : mountedAt

  React.useEffect(() => {
    if (!streaming) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [streaming, start])

  React.useLayoutEffect(() => {
    if (previousLabelRef.current === status.label) return
    setOutgoingLabel(previousLabelRef.current)
    previousLabelRef.current = status.label
    const timer = window.setTimeout(() => setOutgoingLabel(undefined), 200)
    return () => window.clearTimeout(timer)
  }, [status.label])

  if (streaming) lastElapsedRef.current = Math.max(0, now - start)
  else if (durationMs != null && Number.isFinite(durationMs)) lastElapsedRef.current = Math.max(0, durationMs)
  const elapsed = lastElapsedRef.current

  return (
    <div data-process-live-status="" data-disclosure-group="" className="process-live-status">
      <span className="process-live-dots" data-running={status.running} aria-hidden="true">
        <span>·</span><span>·</span><span>·</span>
      </span>
      <span data-process-current-action="" className="process-live-action" title={status.label} aria-live="polite" aria-atomic="true">
        {outgoingLabel && <span aria-hidden="true" className="process-live-action-outgoing">{outgoingLabel}</span>}
        <span key={status.label} className="process-live-action-text">{status.label}</span>
      </span>
      {elapsed != null && <span data-process-elapsed="" className="process-live-time">{formatProcessElapsed(elapsed)}</span>}
      {children}
    </div>
  )
}
