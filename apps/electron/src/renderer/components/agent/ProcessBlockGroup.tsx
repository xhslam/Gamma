import * as React from 'react'
import { atom, useAtomValue } from 'jotai'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { useMessageSessionId } from '@/components/ai-elements/message'
import { cn } from '@/lib/utils'
import { ProcessTimelineStep } from './ProcessTimelineStep'
import { ProcessCurrentToolContext } from './ProcessTimelineContent'
import { isVisibleProcessBlock } from './process-block-visibility'
import { ProcessLiveStatus } from './ProcessLiveStatus'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { getProcessLiveStatus, type ProcessLiveStatus as LiveStatus } from './process-live-status'
import { TaskProgressCard } from './TaskProgressCard'
import { aggregateTaskItems } from './task-progress'
import './process-timeline.css'
import type {
  SDKMessage,
  SDKContentBlock,
  SDKTextBlock,
  SDKThinkingBlock,
} from '@carpus/shared'

interface ProcessBlockGroupProps {
  blocks: SDKContentBlock[]
  allMessages?: SDKMessage[]
  isStreaming?: boolean
  /** 多段日志只在当前段显示整个请求的计时。 */
  showElapsed?: boolean
  liveStatusOverride?: LiveStatus
  taskActivities?: ToolActivity[]
  historicalTaskSubjects?: Map<string, string>
  startedAt?: number
  durationMs?: number
  /** 惰性生成过程项；流式与历史态均渲染完整内容。 */
  renderChildren: () => React.ReactNode
}

const EMPTY_PERMISSION_REQUESTS_ATOM = atom<ReadonlyMap<string, { toolUseId?: string }[]>>(new Map())
const EMPTY_MESSAGES: SDKMessage[] = []
const EMPTY_ACTIVITIES: ToolActivity[] = []
const PROCESS_GROUP_VIEWPORT_HEIGHT = 320
const PROCESS_GROUP_LIVE_CHILD_WINDOW = 4
const PROCESS_GROUP_COLLAPSE_DURATION_MS = 320
const PROCESS_GROUP_FOLLOW_BOTTOM_THRESHOLD = 24
const PROGRESS_SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

interface IndexedContentBlock {
  block: SDKContentBlock
  index: number
}

export type AssistantTurnRenderItem =
  | { type: 'block'; item: IndexedContentBlock }
  | {
      type: 'process-group'
      items: IndexedContentBlock[]
    }

/** 正常回复独立渲染，后续工具不得把它移进可折叠日志。 */
export function buildAssistantTurnRenderItems(blocks: SDKContentBlock[]): AssistantTurnRenderItem[] {
  const items: AssistantTurnRenderItem[] = []
  blocks.forEach((block, index) => {
    if (!isVisibleProcessBlock(block)) return
    if (block.type === 'text') {
      items.push({ type: 'block', item: { block, index } })
      return
    }
    const last = items.at(-1)
    if (last?.type === 'process-group') last.items.push({ block, index })
    else items.push({ type: 'process-group', items: [{ block, index }] })
  })
  return items
}

/**
 * Reuse the previous array when streaming only changes a sibling block, such as
 * an already-externalized final text block. Delta updates replace changed block
 * objects immutably, so reference identity is enough to detect process changes.
 */
export function stabilizeProcessBlockReferences(
  previous: SDKContentBlock[],
  next: SDKContentBlock[],
): SDKContentBlock[] {
  if (previous.length !== next.length) return next
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return next
  }
  return previous
}

export function isProgressViewportAtBottom({
  clientHeight,
  scrollHeight,
  scrollTop,
}: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>): boolean {
  return scrollHeight - scrollTop - clientHeight <= PROCESS_GROUP_FOLLOW_BOTTOM_THRESHOLD
}

function getProcessChildKey(child: React.ReactNode, index: number): string {
  if (React.isValidElement(child) && child.key != null) return String(child.key)
  return `process-child-${index}`
}

interface StableProcessChildCacheEntry {
  child: React.ReactNode
  snapshot: string
}

function getProcessChildSnapshot(child: React.ReactNode): string | null {
  if (!React.isValidElement(child) || child.type !== React.Fragment) return null
  const fragmentProps = child.props as { children?: React.ReactNode }
  const content = fragmentProps.children
  if (!React.isValidElement(content)) return null
  const contentProps = content.props as { block?: SDKContentBlock }
  const block = contentProps.block
  if (!block || (block.type !== 'text' && block.type !== 'thinking')) return null
  const text = block.type === 'text'
    ? (block as SDKTextBlock).text
    : (block as SDKThinkingBlock).thinking
  return `${block.type}:${text}`
}

const StableProcessChild = React.memo(
  function StableProcessChild({ child }: { child: React.ReactNode }): React.ReactElement {
    return <>{child}</>
  },
  (previous, next) => previous.child === next.child,
)

export function usePendingProcessToolIds(enabled = true): ReadonlySet<string> {
  const sessionId = useMessageSessionId()
  const pendingPermissions = useAtomValue(enabled ? allPendingPermissionRequestsAtom : EMPTY_PERMISSION_REQUESTS_ATOM)
  return React.useMemo(() => new Set(
    sessionId ? pendingPermissions.get(sessionId)?.map((request) => request.toolUseId).filter((id): id is string => !!id) : [],
  ), [sessionId, pendingPermissions])
}

export function ProcessBlockGroup({
  blocks, allMessages = EMPTY_MESSAGES, isStreaming = false, showElapsed = true, liveStatusOverride,
  taskActivities = EMPTY_ACTIVITIES, historicalTaskSubjects, startedAt, durationMs, renderChildren,
}: ProcessBlockGroupProps): React.ReactElement {
  const contentId = React.useId()
  // 跟随执行状态自动展开与收拢；用户点击后优先保留其选择。
  const [manualExpanded, setContentExpanded] = React.useState<boolean | null>(null)
  const isContentExpanded = manualExpanded ?? isStreaming
  const [shouldRenderContent, setShouldRenderContent] = React.useState(false)
  const followLatestRef = React.useRef(true)
  const smoothScrollTargetRef = React.useRef<number | null>(null)
  const scrollFrameRef = React.useRef<number | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const contentInnerRef = React.useRef<HTMLDivElement>(null)
  const stableChildrenRef = React.useRef(new Map<string, StableProcessChildCacheEntry>())
  const stableProcessBlocksRef = React.useRef(blocks)
  stableProcessBlocksRef.current = stabilizeProcessBlockReferences(stableProcessBlocksRef.current, blocks)
  const stableProcessBlocks = stableProcessBlocksRef.current
  const keepProgressViewport = false
  const shouldShowContent = isContentExpanded || shouldRenderContent
  const visibleChildren = shouldShowContent ? renderChildren() : null
  const pendingToolIds = usePendingProcessToolIds(isStreaming && !liveStatusOverride)
  const taskItems = React.useMemo(
    () => aggregateTaskItems(taskActivities, !isStreaming, historicalTaskSubjects),
    [taskActivities, isStreaming, historicalTaskSubjects],
  )
  const taskActiveForm = taskItems.findLast((item) => item.status === 'in_progress')?.activeForm
  const liveStatus = React.useMemo(
    () => liveStatusOverride ?? getProcessLiveStatus(blocks, allMessages, isStreaming, pendingToolIds, taskActiveForm),
    [blocks, allMessages, isStreaming, pendingToolIds, taskActiveForm, liveStatusOverride],
  )

  React.useEffect(() => {
    if (isContentExpanded) {
      setShouldRenderContent(true)
      return
    }
    const timer = window.setTimeout(() => setShouldRenderContent(false), PROCESS_GROUP_COLLAPSE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [isContentExpanded])

  const scrollToLatest = React.useCallback(() => {
    if (!followLatestRef.current) return
    const viewport = contentRef.current
    if (!viewport) return

    smoothScrollTargetRef.current = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    if (scrollFrameRef.current !== null) return

    const advanceScroll = (): void => {
      const target = smoothScrollTargetRef.current
      const activeViewport = contentRef.current
      if (!followLatestRef.current || target == null || !activeViewport) {
        scrollFrameRef.current = null
        return
      }

      const distance = target - activeViewport.scrollTop
      if (Math.abs(distance) <= 1) {
        activeViewport.scrollTop = target
        smoothScrollTargetRef.current = null
        scrollFrameRef.current = null
        return
      }

      // 内容突增时快速追近，正常增量则保持低成本的连续插值。
      const nextTop = distance > 72
        ? target - 48
        : activeViewport.scrollTop + distance * 0.32
      activeViewport.scrollTop = nextTop
      scrollFrameRef.current = requestAnimationFrame(advanceScroll)
    }

    scrollFrameRef.current = requestAnimationFrame(advanceScroll)
  }, [])

  React.useLayoutEffect(() => {
    if (!isStreaming || !keepProgressViewport) return
    const content = contentInnerRef.current
    if (!content) return

    const frame = requestAnimationFrame(scrollToLatest)
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      observer.disconnect()
    }
  }, [isStreaming, keepProgressViewport, scrollToLatest])

  React.useLayoutEffect(() => {
    if (isStreaming && keepProgressViewport) scrollToLatest()
  }, [stableProcessBlocks, isStreaming, keepProgressViewport, scrollToLatest])

  const handleProgressScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    if (!isProgressViewportAtBottom(event.currentTarget)) return
    followLatestRef.current = true
    scrollToLatest()
  }, [scrollToLatest])

  const handleProgressScrollIntent = React.useCallback((): void => {
    smoothScrollTargetRef.current = null
    followLatestRef.current = false
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  const handleProgressKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (PROGRESS_SCROLL_KEYS.has(event.key)) handleProgressScrollIntent()
  }, [handleProgressScrollIntent])

  // 只让最近几项参与高频更新；旧项保留在 DOM 中供用户滚动查看，但冻结其 React 子树。
  const renderContentChildren = (): React.ReactNode => {
    const childArray = React.Children.toArray(visibleChildren)
      .map<{ child: React.ReactNode; block: SDKContentBlock | undefined }>((child, index) => ({ child, block: blocks[index] }))
      .filter((item): item is { child: React.ReactNode; block: SDKContentBlock } => !!item.block && isVisibleProcessBlock(item.block))
    const liveStart = Math.max(0, childArray.length - PROCESS_GROUP_LIVE_CHILD_WINDOW)
    const activeKeys = new Set<string>()
    const currentToolId = isStreaming
      ? childArray.flatMap(({ block }) => block.type === 'tool_use' && typeof block.id === 'string' ? [block.id] : []).at(-1) ?? null
      : null

    const rendered = childArray.map(({ child, block }, i) => {
      const key = getProcessChildKey(child, i)
      activeKeys.add(key)
      const cachedEntry = stableChildrenRef.current.get(key)
      const snapshot = getProcessChildSnapshot(child)
      const shouldFreeze = !!isStreaming && i < liveStart && snapshot !== null
      const stableChild = shouldFreeze && cachedEntry?.snapshot === snapshot
        ? cachedEntry.child
        : child
      if (!shouldFreeze || !cachedEntry || cachedEntry.snapshot !== snapshot) {
        stableChildrenRef.current.set(key, { child, snapshot: snapshot ?? '' })
      }

      const isLast = i === childArray.length - 1
      return (
        <ProcessTimelineStep
          key={key}
          block={block}
          allMessages={allMessages}
          isStreaming={isStreaming}
          isLast={isLast}
        >
          <ProcessCurrentToolContext.Provider value={currentToolId}>
            <StableProcessChild child={stableChild} />
          </ProcessCurrentToolContext.Provider>
        </ProcessTimelineStep>
      )
    })

    for (const key of stableChildrenRef.current.keys()) {
      if (!activeKeys.has(key)) stableChildrenRef.current.delete(key)
    }
    return rendered
  }

  return (
    <div className="process-timeline">
      <TaskProgressCard
        activities={taskActivities}
        streamEnded={!isStreaming}
        historicalTaskSubjects={historicalTaskSubjects}
        approvalPending={liveStatus.waiting}
      />
      <ProcessLiveStatus status={isStreaming ? liveStatus : { ...liveStatus, label: blocks.some((block) => block.type === 'tool_use') ? `已执行 ${blocks.filter((block) => block.type === 'tool_use').length} 项操作` : liveStatus.label }} streaming={isStreaming} showElapsed={showElapsed} startedAt={startedAt} durationMs={durationMs}>
        <button
          type="button"
          data-process-group-toggle=""
          data-disclosure-trigger=""
          data-icon-button="true"
          aria-expanded={isContentExpanded}
          aria-controls={contentId}
          className="process-timeline-toggle"
          aria-label={isContentExpanded ? '收起工具调用日志' : '展开工具调用日志'}
          onClick={() => setContentExpanded(!isContentExpanded)}
        >
          <DisclosureChevron expanded={isContentExpanded} size={12} />
        </button>
      </ProcessLiveStatus>
      {shouldShowContent && (
        <div
          ref={contentRef}
          id={contentId}
          aria-hidden={!isContentExpanded}
          data-process-log=""
          data-expanded={isContentExpanded}
          data-agent-history-selection-excluded={isContentExpanded ? undefined : 'true'}
          className={cn(
            'process-timeline-log overflow-hidden focus:outline-none',
            keepProgressViewport && 'overflow-y-auto overscroll-contain scrollbar-none',
          )}
          tabIndex={keepProgressViewport ? 0 : undefined}
          onScroll={keepProgressViewport ? handleProgressScroll : undefined}
          onPointerDown={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onWheel={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onTouchStart={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onKeyDown={keepProgressViewport ? handleProgressKeyDown : undefined}
          style={{
            maxHeight: keepProgressViewport ? `${PROCESS_GROUP_VIEWPORT_HEIGHT}px` : undefined,
            opacity: isContentExpanded ? 1 : 0,
            pointerEvents: isContentExpanded ? undefined : 'none',
          }}
        >
          <div ref={contentInnerRef} className="pl-1">
            {renderContentChildren()}
          </div>
        </div>
      )}
    </div>
  )
}
