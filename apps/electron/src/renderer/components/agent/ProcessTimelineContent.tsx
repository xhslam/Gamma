import * as React from 'react'
import type { SDKToolUseBlock } from '@gamma/shared'
import { cn } from '@/lib/utils'
import { getProcessActionLabel } from './process-timeline-presentation'

interface ProcessTimelineToolProps {
  block: SDKToolUseBlock
  children: React.ReactNode
}

export function ProcessTimelineTool({ block, children }: ProcessTimelineToolProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const contentId = React.useId()
  const label = getProcessActionLabel(block)

  return (
    <div>
      <button
        type="button"
        className="process-timeline-row"
        data-process-action-row=""
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0 truncate" title={[label.action, label.object].filter(Boolean).join(' ')}>
          {label.action}
          {label.action && label.object ? ' ' : null}
          {label.object && <span className={cn(label.monospace && 'font-mono')}>{label.object.replace(/\s*\n\s*/g, ' ')}</span>}
        </span>
      </button>
      {expanded && <div id={contentId} className="process-timeline-details">{children}</div>}
    </div>
  )
}

interface ProcessTimelineTextProps {
  text: string
  thinking?: boolean
}

/** 思考只保留两行斜体预览；点击原文即可展开，不额外添加标签或展开按钮。 */
export function ProcessTimelineText({ text, thinking = false }: ProcessTimelineTextProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [overflows, setOverflows] = React.useState(false)
  const textRef = React.useRef<HTMLSpanElement>(null)
  const contentId = React.useId()

  React.useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = (): void => setOverflows(element.scrollHeight > 56)
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [text])

  return (
    <button
      type="button"
      className={cn('process-timeline-row process-timeline-text-row', thinking && 'process-timeline-thinking')}
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => { if (overflows || expanded) setExpanded((value) => !value) }}
    >
      <span id={contentId} ref={textRef} data-process-text="" className={cn('process-timeline-text', !expanded && 'line-clamp-2')}>{text}</span>
    </button>
  )
}
