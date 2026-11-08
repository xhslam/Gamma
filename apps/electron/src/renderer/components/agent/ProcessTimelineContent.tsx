import * as React from 'react'
import type { SDKToolUseBlock } from '@gamma/shared'
import { FileText, Search, Terminal } from 'lucide-react'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { cn } from '@/lib/utils'
import { getProcessActionLabel } from './process-timeline-presentation'

/** 当前操作变更时，历史卡片恢复自动收起；用户仍可重新展开查看。 */
export const ProcessCurrentToolContext = React.createContext<string | null>(null)

interface ProcessTimelineToolProps {
  block: SDKToolUseBlock
  children: React.ReactNode
}

export function ProcessTimelineTool({ block, children }: ProcessTimelineToolProps): React.ReactElement {
  const currentToolId = React.useContext(ProcessCurrentToolContext)
  const [manualExpansion, setManualExpansion] = React.useState<{ toolId: string | null; expanded: boolean } | null>(null)
  const expanded = manualExpansion?.toolId === currentToolId
    ? manualExpansion.expanded
    : currentToolId === block.id
  const contentId = React.useId()
  const label = getProcessActionLabel(block)
  const name = block.name.toLowerCase()
  const Icon = ['bash', 'terminalexecute'].includes(name) ? Terminal : /search|grep|glob|find/.test(name) ? Search : FileText

  return (
    <div className="process-trace-tool">
      <button
        type="button"
        className="process-timeline-row"
        data-process-action-row=""
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setManualExpansion({ toolId: currentToolId, expanded: !expanded })}
      >
        <Icon size={14} className="process-trace-icon" aria-hidden="true" />
        <span className="min-w-0 truncate" title={[label.action, label.object].filter(Boolean).join(' ')}>
          {label.action}
          {label.action && label.object ? ' ' : null}
          {label.object && <span className={cn(label.monospace && 'font-mono')}>{label.object.replace(/\s*\n\s*/g, ' ')}</span>}
        </span>
        <DisclosureChevron expanded={expanded} size={12} />
      </button>
      <div className="process-trace-reveal" data-open={expanded} aria-hidden={!expanded} ref={(element) => { element?.toggleAttribute('inert', !expanded) }}>
        <div className="process-trace-clip">
          <div id={contentId} className="process-timeline-details">{children}</div>
        </div>
      </div>
    </div>
  )
}

interface ProcessTimelineTextProps {
  text: string
  thinking?: boolean
}

/** 过程文字统一为单行预览；折叠时不让原文空行撑高节点，展开后保留完整格式。 */
export function ProcessTimelineText({ text, thinking = false }: ProcessTimelineTextProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)
  const textRef = React.useRef<HTMLSpanElement>(null)
  const contentId = React.useId()
  const preview = text.replace(/\s+/g, ' ').trim()

  React.useLayoutEffect(() => {
    const element = textRef.current
    if (!element || expanded) return
    const measure = (): void => setCanExpand(element.scrollWidth > element.clientWidth || /[\r\n\u2028\u2029]/.test(text.trim()))
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [text, expanded])

  return (
    <button
      type="button"
      className={cn('process-timeline-row process-timeline-text-row', thinking && 'process-timeline-thinking')}
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => { if (canExpand || expanded) setExpanded((value) => !value) }}
    >
      <span id={contentId} ref={textRef} data-process-text="" className="process-timeline-text">{expanded ? text : preview}</span>
    </button>
  )
}
