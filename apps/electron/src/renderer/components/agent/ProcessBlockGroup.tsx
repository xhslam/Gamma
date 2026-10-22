import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProcessTimelineStep } from './ProcessTimelineStep'
import './process-timeline.css'
import type {
  SDKMessage,
  SDKContentBlock,
  SDKTextBlock,
  SDKThinkingBlock,
} from '@gamma/shared'

interface ProcessBlockGroupProps {
  blocks: SDKContentBlock[]
  allMessages?: SDKMessage[]
  isStreaming?: boolean
  /** 惰性生成过程项；流式与历史态均渲染完整内容。 */
  renderChildren: () => React.ReactNode
}

const EMPTY_MESSAGES: SDKMessage[] = []
const PROCESS_GROUP_VIEWPORT_HEIGHT = 320
const PROCESS_GROUP_LIVE_CHILD_WINDOW = 4
const PROCESS_GROUP_COLLAPSE_DURATION_MS = 500
const PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS = 900
const PROCESS_GROUP_AUTO_COLLAPSE_DELAY_MS = 3000
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

interface BuildAssistantTurnRenderItemsOptions {
  isStreaming?: boolean
}

function getTrailingTextStartIndex(blocks: SDKContentBlock[]): number | null {
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.type !== 'text') return null

  let finalStartIndex = blocks.length - 1
  while (finalStartIndex > 0 && blocks[finalStartIndex - 1]?.type === 'text') {
    finalStartIndex -= 1
  }
  return finalStartIndex
}

export function buildAssistantTurnRenderItems(
  blocks: SDKContentBlock[],
  options: BuildAssistantTurnRenderItemsOptions = {},
): AssistantTurnRenderItem[] {
  if (blocks.length === 0) return []

  // 只要流式末尾出现 text，就按常规消息布局直接展示。若 Agent 之后继续调用工具，
  // text 不再位于末尾，会自动回归过程组，避免把中间状态误认为最终答案。
  const hasProcessBlock = blocks.some((block) => block.type === 'tool_use' || block.type === 'thinking')
  const trailingTextStartIndex = getTrailingTextStartIndex(blocks)
  const canSplitStreamingFinalOutput = options.isStreaming
    && hasProcessBlock
    && trailingTextStartIndex !== null
    && trailingTextStartIndex > 0

  if (options.isStreaming && hasProcessBlock && !canSplitStreamingFinalOutput) {
    return buildProcessGroupItems(blocks)
  }

  if (trailingTextStartIndex === null) {
    return buildProcessGroupItems(blocks)
  }

  const items: AssistantTurnRenderItem[] = []
  if (trailingTextStartIndex > 0) {
    items.push(...buildProcessGroupItems(
      blocks.slice(0, trailingTextStartIndex),
    ))
  }

  for (let index = trailingTextStartIndex; index < blocks.length; index++) {
    const block = blocks[index]
    if (!block) continue
    items.push({ type: 'block', item: { block, index } })
  }

  return items
}

function buildProcessGroupItems(blocks: SDKContentBlock[]): AssistantTurnRenderItem[] {
  return [{
    type: 'process-group',
    items: blocks.map((block, index) => ({ block, index })),
  }]
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

function buildProcessGroupSummary(blocks: SDKContentBlock[]): string {
  const tools = blocks.filter((block) => block.type === 'tool_use').length
  const thoughts = blocks.filter((block) => block.type === 'thinking').length
  return `${tools} 次工具调用 · ${thoughts} 条思考`
}

type ProcessGroupDisplayMode = 'collapsed' | 'expanded'

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

export function ProcessBlockGroup({ blocks, allMessages = EMPTY_MESSAGES, isStreaming, renderChildren }: ProcessBlockGroupProps): React.ReactElement {
  const contentId = React.useId()
  const initialDisplayMode: ProcessGroupDisplayMode = !isStreaming
    ? 'collapsed'
    : 'expanded'
  const [displayMode, setDisplayMode] = React.useState<ProcessGroupDisplayMode>(initialDisplayMode)
  const [shouldRenderContent, setShouldRenderContent] = React.useState(initialDisplayMode !== 'collapsed')
  const [keepProgressViewport, setKeepProgressViewport] = React.useState(!!isStreaming)
  const userToggledRef = React.useRef(false)
  const followLatestRef = React.useRef(true)
  const smoothScrollTargetRef = React.useRef<number | null>(null)
  const scrollFrameRef = React.useRef<number | null>(null)
  const wasStreamingRef = React.useRef(!!isStreaming)
  const autoCollapseTimersRef = React.useRef<number[]>([])
  const contentRef = React.useRef<HTMLDivElement>(null)
  const contentInnerRef = React.useRef<HTMLDivElement>(null)
  const stableChildrenRef = React.useRef(new Map<string, StableProcessChildCacheEntry>())
  const stableProcessBlocksRef = React.useRef(blocks)
  stableProcessBlocksRef.current = stabilizeProcessBlockReferences(stableProcessBlocksRef.current, blocks)
  const stableProcessBlocks = stableProcessBlocksRef.current
  const collapseFrameRef = React.useRef<number | null>(null)
  const [measuredHeight, setMeasuredHeight] = React.useState<number | undefined>(undefined)

  const isContentExpanded = displayMode === 'expanded'
  const shouldShowContent = isContentExpanded || shouldRenderContent
  const visibleChildren = shouldShowContent ? renderChildren() : null

  const clearAutoCollapseTimers = React.useCallback(() => {
    for (const timer of autoCollapseTimersRef.current) window.clearTimeout(timer)
    autoCollapseTimersRef.current = []
  }, [])

  React.useEffect(() => {
    clearAutoCollapseTimers()

    if (isStreaming) {
      setKeepProgressViewport(true)
      if (!wasStreamingRef.current) {
        userToggledRef.current = false
        followLatestRef.current = true
        smoothScrollTargetRef.current = null
        if (scrollFrameRef.current !== null) {
          cancelAnimationFrame(scrollFrameRef.current)
          scrollFrameRef.current = null
        }
      }
      if (!userToggledRef.current) setDisplayMode('expanded')
      wasStreamingRef.current = true
      return
    }

    const shouldAutoCollapseAfterCompletion = wasStreamingRef.current && !userToggledRef.current
    wasStreamingRef.current = false

    if (!shouldAutoCollapseAfterCompletion) {
      setKeepProgressViewport(false)
      if (!userToggledRef.current) setDisplayMode('collapsed')
      return
    }

    const timer = window.setTimeout(() => {
      setDisplayMode('collapsed')
      autoCollapseTimersRef.current.push(window.setTimeout(
        () => setKeepProgressViewport(false),
        PROCESS_GROUP_COLLAPSE_DURATION_MS,
      ))
    }, PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS + PROCESS_GROUP_AUTO_COLLAPSE_DELAY_MS)
    autoCollapseTimersRef.current.push(timer)

    return clearAutoCollapseTimers
  }, [clearAutoCollapseTimers, isStreaming])

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

  // 折叠前测量实际高度，用于丝滑的 height 过渡（子元素不 reflow，只裁剪边界）
  React.useEffect(() => {
    if (isContentExpanded) {
      if (collapseFrameRef.current !== null) {
        cancelAnimationFrame(collapseFrameRef.current)
        collapseFrameRef.current = null
      }
      setShouldRenderContent(true)
      setMeasuredHeight(undefined)
      return
    }

    // 折叠时：先测量当前高度，触发 height 过渡动画，动画结束后卸载 DOM
    const el = contentRef.current
    if (el) {
      const h = el.clientHeight
      setMeasuredHeight(h)
      collapseFrameRef.current = requestAnimationFrame(() => {
        collapseFrameRef.current = null
        setMeasuredHeight(0)
      })
    }

    const timer = window.setTimeout(() => setShouldRenderContent(false), PROCESS_GROUP_COLLAPSE_DURATION_MS)
    return () => {
      window.clearTimeout(timer)
      if (collapseFrameRef.current !== null) {
        cancelAnimationFrame(collapseFrameRef.current)
        collapseFrameRef.current = null
      }
    }
  }, [isContentExpanded])

  const summary = React.useMemo(
    () => buildProcessGroupSummary(blocks),
    [blocks],
  )
  // 只让最近几项参与高频更新；旧项保留在 DOM 中供用户滚动查看，但冻结其 React 子树。
  const renderContentChildren = (): React.ReactNode => {
    const childArray = React.Children.toArray(visibleChildren)
    const liveStart = Math.max(0, childArray.length - PROCESS_GROUP_LIVE_CHILD_WINDOW)
    const activeKeys = new Set<string>()

    const rendered = childArray.map((child, i) => {
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
          block={blocks[i]!}
          allMessages={allMessages}
          isStreaming={isStreaming}
          isLast={isLast}
        >
          <StableProcessChild child={stableChild} />
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
      <button
        type="button"
        data-process-group-toggle=""
        aria-expanded={isContentExpanded}
        aria-controls={contentId}
        className="process-timeline-toggle"
        aria-label={`执行过程：${summary}`}
        onClick={() => {
          userToggledRef.current = true
          clearAutoCollapseTimers()
          if (!isStreaming) setKeepProgressViewport(false)
          setDisplayMode((previous) => previous === 'collapsed' ? 'expanded' : 'collapsed')
        }}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform duration-150',
            isContentExpanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 truncate">{summary}</span>
      </button>

      {shouldRenderContent && (
        <div
          ref={contentRef}
          id={contentId}
          aria-hidden={!isContentExpanded}
          data-agent-history-selection-excluded={isContentExpanded ? undefined : 'true'}
          className={cn(
            'overflow-hidden focus:outline-none',
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
            height: measuredHeight !== undefined ? `${measuredHeight}px` : 'auto',
            opacity: isContentExpanded ? 1 : 0,
            transition: measuredHeight !== undefined
              ? `height ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out, opacity ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out`
              : `opacity ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out`,
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
