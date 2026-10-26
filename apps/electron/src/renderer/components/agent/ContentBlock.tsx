/**
 * ContentBlock — 单个 SDKAssistantMessage 内容块渲染
 *
 * 支持三种内容块类型：
 * - text: 通过 MessageResponse 渲染 Markdown
 * - tool_use: 语义化短语行（如 "读取 foo.ts 第 10-60 行"），展开显示结构化结果
 * - thinking: 默认折叠，左上角 "Thinking" 标签 + 虚线边框内容区
 */

import * as React from 'react'
import {
  XCircle,
  Loader2,
  Brain,
  MessageSquareText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MessageResponse } from '@/components/ai-elements/message'
import { getToolIcon, extractFilePath } from './tool-utils'
import { getToolPhrase, getToolResultSummary, shouldShowToolKindLabel } from './tool-phrase'
import { ToolResultRenderer } from './tool-result-renderers'
import { PreviewOpenButton } from './tool-result-renderers/preview-open-button'
import { getTaskGetStatusLabel, parseTaskGetResult, type ParsedTaskGetResult } from './tool-result-renderers/task-get-result'
import { parseTaskListResult, type ParsedTaskListItem } from './tool-result-renderers/task-list-result'
import { formatDuration } from './AgentMessages'
import { useSmoothStream } from '@gamma/ui'
import { useToolExecution } from './use-tool-execution'
import { ProcessTimelineContext, ProcessTimelineStep } from './ProcessTimelineStep'
import { ProcessTimelineText, ProcessTimelineTool } from './ProcessTimelineContent'
import type {
  SDKContentBlock,
  SDKMessage,
  SDKTextBlock,
  SDKToolUseBlock,
  SDKThinkingBlock,
  SDKSystemMessage,
} from '@gamma/shared'
import { FadeTitle } from '@/components/ui/fade-title'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

// ===== useSubAgentMeta Hook =====

interface SubAgentMeta {
  durationMs: number
  totalTokens: number
  toolUses: number
}

/** 从 allMessages 中查找匹配 toolUseId 的 task_notification 系统消息，提取用量数据 */
function useSubAgentMeta(toolUseId: string, allMessages: SDKMessage[]): SubAgentMeta | null {
  return React.useMemo(() => {
    for (const msg of allMessages) {
      if (msg.type !== 'system') continue
      const sysMsg = msg as SDKSystemMessage
      if (sysMsg.subtype !== 'task_notification') continue
      if (sysMsg.tool_use_id !== toolUseId) continue
      const usage = sysMsg.usage
      if (!usage) return null
      return {
        durationMs: usage.duration_ms ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        toolUses: usage.tool_uses ?? 0,
      }
    }
    return null
  }, [toolUseId, allMessages])
}

// ===== SubAgent 结果文本解析 =====

interface ParsedAgentResult {
  /** 清理后的输出文本（去除元数据） */
  text: string
  /** 从 <usage> 标签解析的用量数据（作为 task_notification 的备用） */
  usage?: SubAgentMeta
}

/** 从 Agent tool_result 文本中分离内容与元数据（agentId 行 + <usage> 标签） */
function parseAgentResultText(raw: string): ParsedAgentResult {
  let text = raw

  // 提取 <usage> 标签中的用量数据
  let usage: SubAgentMeta | undefined
  const usageMatch = text.match(/<usage>([\s\S]*?)<\/usage>/)
  if (usageMatch) {
    const body = usageMatch[1]!
    const totalTokens = Number(body.match(/total_tokens:\s*(\d+)/)?.[1]) || 0
    const toolUses = Number(body.match(/tool_uses:\s*(\d+)/)?.[1]) || 0
    const durationMs = Number(body.match(/duration_ms:\s*(\d+)/)?.[1]) || 0
    if (totalTokens > 0 || toolUses > 0 || durationMs > 0) {
      usage = { durationMs, totalTokens, toolUses }
    }
    text = text.replace(/<usage>[\s\S]*?<\/usage>/, '')
  }

  // 移除 agentId 行
  text = text.replace(/agentId:.*\n?/g, '')

  // 移除 <output> 标签包裹
  text = text.replace(/<\/?output>/g, '')

  return { text: text.trim(), usage }
}

// ===== SubAgent 完成信息尾部 =====

function SubAgentFooter({
  meta,
  resultText,
}: {
  meta: SubAgentMeta | null
  resultText?: string
}): React.ReactElement | null {
  // 解析结果文本，分离内容与元数据
  const parsed = React.useMemo(
    () => resultText ? parseAgentResultText(resultText) : null,
    [resultText],
  )

  // 优先使用 task_notification 的用量数据，备用从 result 文本中解析
  const effectiveMeta = meta ?? parsed?.usage ?? null
  const cleanText = parsed?.text || ''

  // 没有任何信息时不渲染
  if (!effectiveMeta && !cleanText) return null

  return (
    <div className="mt-2 pt-2 border-t border-border/20 space-y-1.5">
      {/* 最终输出文本（Markdown 渲染） */}
      {cleanText && (
        <div className="text-muted-foreground/70">
          <MessageResponse>{cleanText}</MessageResponse>
        </div>
      )}

      {/* 用量统计行（最底部） */}
      {effectiveMeta && (
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground/60 tabular-nums">
          {effectiveMeta.durationMs > 0 && (
            <span>{formatDuration(effectiveMeta.durationMs)}</span>
          )}
          {effectiveMeta.totalTokens > 0 && (
            <span>{effectiveMeta.totalTokens.toLocaleString()} tokens</span>
          )}
          {effectiveMeta.toolUses > 0 && (
            <span>{effectiveMeta.toolUses} 次工具调用</span>
          )}
        </div>
      )}
    </div>
  )
}

// ===== ContentBlock Props =====

export interface ContentBlockProps {
  /** 内容块数据 */
  block: SDKContentBlock
  /** 所有消息（用于查找工具结果） */
  allMessages: SDKMessage[]
  /** 相对路径解析基准（文件链接用） */
  basePath?: string
  /** 多个可解析相对路径的基准目录 */
  basePaths?: string[]
  /** 是否启用入场动画 */
  animate?: boolean
  /** 在父级中的索引（用于动画延迟） */
  index?: number
  /** 当 turn 中已有主要内容（text）时，非主要块（tool/thinking）颜色变淡 */
  dimmed?: boolean
  /** 子代理的内容块（Agent/Task 工具调用的嵌套子块） */
  childBlocks?: SDKContentBlock[]
  /** 是否正在流式输出中（仅流式中的未完成工具调用才显示 spinner） */
  isStreaming?: boolean
}

// ===== 提示词折叠行 =====

function PromptRow({ prompt, dimmed = false }: { prompt: string; dimmed?: boolean }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const preview = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt

  return (
    <div>
      <button data-disclosure-trigger="" aria-expanded={expanded}
        type="button"
        className="flex items-center gap-2 py-0.5 text-left hover:opacity-70 transition-opacity group"
        onClick={() => setExpanded(!expanded)}
      >
        <MessageSquareText className={cn('size-3.5 shrink-0', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')} />

        <span className={cn(
          'shrink-0 text-[14px]',
          dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}>提示词</span>

        <span className={cn(
          'truncate text-[14px]',
          dimmed ? 'text-muted-foreground/50' : 'text-muted-foreground/60',
        )}>
          {preview}
        </span>

        <DisclosureChevron expanded={expanded} size={12}
          className={cn(
            'shrink-0 size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-all duration-150',
            expanded && 'rotate-90 opacity-100',
          )}
        />
      </button>

      {expanded && (
        <div className="ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30 animate-in fade-in slide-in-from-top-1 duration-150">
          <p className="text-[13px] text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
            {prompt}
          </p>
        </div>
      )}
    </div>
  )
}

// ===== 工具短语 diff 着色 =====

function TaskGetCollapsedSummary({ task }: { task: ParsedTaskGetResult }): React.ReactElement {
  const blockPreview = task.blocks.length > 0
    ? `${task.blocks[0]}${task.blocks.length > 1 ? ` +${task.blocks.length - 1}` : ''}`
    : undefined

  return (
    <>
      {task.subject && (
        <>
          <span className="shrink-0 text-muted-foreground/35">·</span>
          <FadeTitle className="min-w-0 truncate text-[14px] font-medium text-foreground/75">
            {task.subject}
          </FadeTitle>
        </>
      )}
      {task.description && (
        <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground/60 sm:inline">
          {task.description}
        </span>
      )}
      {task.status && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {getTaskGetStatusLabel(task.status)}
        </span>
      )}
      {blockPreview && (
        <span className="shrink-0 rounded-sm bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground/70">
          关联 {blockPreview}
        </span>
      )}
    </>
  )
}

function TaskListCollapsedSummary({ tasks }: { tasks: ParsedTaskListItem[] }): React.ReactElement {
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const activeCount = tasks.filter((task) => task.status === 'in_progress').length
  const pendingCount = tasks.filter((task) => task.status === 'pending').length

  return (
    <>
      <span className="shrink-0 text-muted-foreground/35">·</span>
      <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/75">
        {completedCount}/{tasks.length} 已完成
      </span>
      {activeCount > 0 && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {activeCount} 进行中
        </span>
      )}
      {pendingCount > 0 && (
        <span className="hidden shrink-0 rounded-full bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground/65 sm:inline">
          {pendingCount} 待处理
        </span>
      )}
    </>
  )
}

// ===== 工具调用块 =====

interface ToolUseBlockProps {
  block: SDKToolUseBlock
  allMessages: SDKMessage[]
  animate?: boolean
  index?: number
  dimmed?: boolean
  childBlocks?: SDKContentBlock[]
  basePath?: string
  /** 是否正在流式输出中 */
  isStreaming?: boolean
}

function ToolUseBlock({ block, allMessages, animate = false, index = 0, dimmed = false, childBlocks, basePath, isStreaming }: ToolUseBlockProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const { result: toolResult, presentation } = useToolExecution(block.id, allMessages, isStreaming)
  const resultText = toolResult?.result
  const isError = toolResult?.isError === true
  const shouldShowResult = !!resultText
  const taskGetSummary = React.useMemo(() => {
    if (block.name !== 'TaskGet' || !resultText || isError) return null
    return parseTaskGetResult(resultText)
  }, [block.name, resultText, isError])
  const taskListSummary = React.useMemo(() => {
    if (block.name !== 'TaskList' || !resultText || isError) return null
    return parseTaskListResult(resultText)
  }, [block.name, resultText, isError])
  const isAgentTool = block.name === 'Agent' || block.name === 'Task'
  const hasChildren = isAgentTool && childBlocks && childBlocks.length > 0
  const subAgentMeta = useSubAgentMeta(block.id, allMessages)

  // Agent/Task 子代理内容默认折叠
  const [childrenExpanded, setChildrenExpanded] = React.useState(false)

  const isFailed = isError || presentation.status === 'error'
  const phrase = getToolPhrase(block.name, block.input, isFailed)
  const ToolIcon = getToolIcon(block.name)
  const toolKindLabel = block.name.startsWith('mcp__') ? block.name.split('__').slice(1).join(' / ') : block.name
  const showToolKindLabel = shouldShowToolKindLabel(block.name, block.input, toolKindLabel, phrase.label)

  const isCompleted = toolResult !== null
  const resultSummary = getToolResultSummary(block.name, resultText, isFailed)
  const displayLabel = presentation.status === 'running' ? phrase.loadingLabel : phrase.label
  const statusBadge = (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-tool-execution-status={presentation.status}
      className={cn('shrink-0 text-[11px] tabular-nums', presentation.tone === 'error' ? 'text-destructive/80' : presentation.tone === 'success' ? 'text-success dark:text-success' : presentation.tone === 'active' ? 'text-primary/80' : 'text-muted-foreground/65')}
    >
      {presentation.label}
    </span>
  )
  const filePath = extractFilePath(block.input)
  const isPreviewable = (
    (block.name === 'Read' || block.name === 'Edit' || block.name === 'Write') &&
    presentation.status === 'success' &&
    filePath
  )

  const delay = animate && index < 10 ? `${index * 30}ms` : '0ms'

  // Agent/Task: 提取 prompt 用于气泡展示
  const agentPrompt = isAgentTool
    ? (typeof block.input.prompt === 'string' ? block.input.prompt : undefined)
    : undefined

  // 子代理工具调用统计
  const childToolCount = childBlocks?.filter((b) => b.type === 'tool_use').length ?? 0

  // ===== Agent/Task 工具：特殊渲染 =====
  if (isAgentTool) {
    return (
      <div
        className={cn(
          animate && 'animate-in fade-in duration-150 fill-mode-both',
        )}
        style={animate ? { animationDelay: delay } : undefined}
      >
        <button data-disclosure-trigger="" aria-expanded={childrenExpanded}
          type="button"
          className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-[background-color,opacity] hover:bg-muted/40 hover:opacity-90"
          onClick={() => setChildrenExpanded(!childrenExpanded)}
        >
          <DisclosureChevron expanded={childrenExpanded} size={12}
            className={cn(
              'size-3 shrink-0 text-muted-foreground/45 transition-transform duration-150',
              childrenExpanded && 'rotate-90',
            )}
          />

          {/* 状态指示：仅流式中的未完成工具才显示 spinner */}
          {presentation.status === 'running' ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary/60" />
          ) : presentation.status === 'error' ? (
            <XCircle className="size-3.5 shrink-0 text-destructive/70" />
          ) : null}

          <ToolIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {showToolKindLabel && (
            <>
              <FadeTitle className="min-w-0 max-w-[28%] truncate text-[14px] font-medium text-muted-foreground/65">{toolKindLabel}</FadeTitle>
              <span className="shrink-0 text-muted-foreground/30">·</span>
            </>
          )}
          <FadeTitle className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">{displayLabel}</FadeTitle>
          {statusBadge}
          {childToolCount > 0 && !childrenExpanded && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/55">
              {childToolCount} 项工具
            </span>
          )}
        </button>

        {/* 展开内容 */}
        {childrenExpanded && (
          <div className={cn(
            'pl-5 mt-1.5 space-y-2 border-l-2 border-primary/20 ml-[5px]',
            animate && 'animate-in fade-in slide-in-from-top-1 duration-150',
          )}>
            {/* 提示词：可折叠行 */}
            {agentPrompt && <PromptRow prompt={agentPrompt} dimmed={dimmed} />}

            {/* 子代理工具调用 */}
            {hasChildren && childBlocks.map((childBlock, ci) => (
              <ContentBlock
                key={ci}
                block={childBlock}
                allMessages={allMessages}
                basePath={basePath}
                animate={animate}
                index={ci}
                dimmed
                isStreaming={isStreaming}
              />
            ))}

            {/* SubAgent 完成信息 */}
            {isCompleted && (
              <SubAgentFooter
                meta={subAgentMeta}
                resultText={toolResult?.result}
              />
            )}

            {/* 底部收起按钮 */}
            <button data-disclosure-trigger="" aria-expanded={childrenExpanded}
              type="button"
              onClick={() => setChildrenExpanded(false)}
              className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
            >
              <DisclosureChevron expanded={childrenExpanded} size={12} className="size-3" />
              <span>收起</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  // ===== 普通工具：语义化短语 + 结构化结果 =====
  return (
    <div
      className={cn(
        animate && 'animate-in fade-in duration-150 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
        <button data-disclosure-trigger="" aria-expanded={expanded}
          type="button"
          className="group inline-flex max-w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-[background-color,opacity] hover:bg-muted/40 hover:opacity-90"
          onClick={() => setExpanded(!expanded)}
        >
          {presentation.status === 'running' ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary/60" />
          ) : presentation.status === 'error' ? (
            <XCircle className="size-3.5 shrink-0 text-destructive/70" />
          ) : null}

          <ToolIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {showToolKindLabel && (
            <>
              <FadeTitle className="min-w-0 max-w-[28%] truncate text-[14px] font-medium text-muted-foreground/65">{toolKindLabel}</FadeTitle>
              <span className="shrink-0 text-muted-foreground/30">·</span>
            </>
          )}
          <FadeTitle className={cn(
            'min-w-0 max-w-[60%] truncate text-[14px]',
            dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
          )}>{displayLabel}</FadeTitle>
          {statusBadge}

          {resultSummary && (
            <span className={cn(
              'shrink-0 text-[11px] tabular-nums',
              isError ? 'text-destructive/70' : 'text-muted-foreground/55',
            )}>
              {resultSummary}
            </span>
          )}

          {phrase.diffStats && presentation.status === 'success' && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums">
              {phrase.diffStats.additions > 0 && (
                <span className="text-success dark:text-success">+{phrase.diffStats.additions}</span>
              )}
              {phrase.diffStats.additions > 0 && phrase.diffStats.deletions > 0 && ' '}
              {phrase.diffStats.deletions > 0 && (
                <span className="text-destructive dark:text-destructive">-{phrase.diffStats.deletions}</span>
              )}
            </span>
          )}

          {taskGetSummary && (
            <span className="flex min-w-0 max-w-[40%] overflow-hidden items-center gap-1.5">
              <TaskGetCollapsedSummary task={taskGetSummary} />
            </span>
          )}

          {taskListSummary && (
            <span className="flex min-w-0 max-w-[40%] overflow-hidden items-center gap-1.5">
              <TaskListCollapsedSummary tasks={taskListSummary} />
            </span>
          )}

          <DisclosureChevron expanded={expanded} size={12}
            className={cn(
              'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />

          {isPreviewable && (
            <PreviewOpenButton filePath={filePath} />
          )}
        </button>

      {shouldShowResult && resultText && expanded && (
        <div className={cn(
          'ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30',
          animate && 'animate-in fade-in slide-in-from-top-1 duration-150',
        )}>
          <ToolResultRenderer
            toolName={block.name}
            input={block.input}
            result={resultText}
            isError={isError}
            basePath={basePath}
          />
        </div>
      )}
    </div>
  )
}

/** 时间线详情沿用现有结果渲染器；收起行不出现状态文字或额外控件。 */
function TimelineToolUseBlock({ block, allMessages, childBlocks, basePath, isStreaming }: ToolUseBlockProps): React.ReactElement {
  const { result } = useToolExecution(block.id, allMessages, isStreaming)
  return (
    <ProcessTimelineTool block={block}>
      {(block.name === 'Agent' || block.name === 'Task') && typeof block.input.prompt === 'string' && (
        <p className="whitespace-pre-wrap break-words">{block.input.prompt}</p>
      )}
      {childBlocks?.map((childBlock, index) => (
        <ProcessTimelineStep key={index} block={childBlock} allMessages={allMessages} isStreaming={isStreaming} isLast={index === childBlocks.length - 1}>
          <ContentBlock block={childBlock} allMessages={allMessages} basePath={basePath} isStreaming={isStreaming} />
        </ProcessTimelineStep>
      ))}
      {result?.result ? (
        <ToolResultRenderer toolName={block.name} input={block.input} result={result.result} isError={result.isError === true} basePath={basePath} />
      ) : !childBlocks?.length ? (
        <pre className="overflow-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(block.input, null, 2)}</pre>
      ) : null}
    </ProcessTimelineTool>
  )
}

// ===== 思考块（默认折叠，Thinking 标签 + 虚线边框） =====

interface ThinkingBlockProps {
  block: SDKThinkingBlock
  dimmed?: boolean
  isStreaming?: boolean
}

/** 思考块折叠行数阈值 */
const THINKING_COLLAPSE_LINE_THRESHOLD = 4

function ThinkingBlock({ block, dimmed = false, isStreaming = false }: ThinkingBlockProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [shouldCollapse, setShouldCollapse] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const { displayedContent } = useSmoothStream({
    content: block.thinking,
    isStreaming,
  })

  // 流式期间避免对每批思考文本同步读取 scrollHeight；这会强制布局且与 Markdown 重渲染叠加。
  // 输出完成后再测量，保留历史态的默认折叠行为。
  React.useLayoutEffect(() => {
    if (isStreaming || !contentRef.current) return
    const el = contentRef.current
    const lineHeight = parseFloat(getComputedStyle(el.querySelector('.reading-body') ?? el).lineHeight) || 26.35
    const maxHeight = lineHeight * THINKING_COLLAPSE_LINE_THRESHOLD
    setShouldCollapse(el.scrollHeight > maxHeight + 10)
  }, [displayedContent, isStreaming])

  const toggleExpand = React.useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return (
    <div className="relative mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className={cn('size-3.5', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')} />
        <span className={cn('text-[14px] uppercase tracking-wider', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
          Thinking
        </span>
      </div>
      <div
        className={cn(
          'relative rounded-lg px-3.5 py-2.5',
          dimmed ? 'bg-muted/30' : 'bg-muted/50',
        )}
        style={{ border: 'none' }}
      >
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          <rect width="100%" height="100%" rx="8" ry="8" fill="none" stroke="hsl(var(--tertiary-foreground))" strokeOpacity={dimmed ? 0.3 : 0.5} strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round" />
        </svg>
        <div
          ref={contentRef}
          data-agent-history-selection-excluded={shouldCollapse && !isExpanded ? 'true' : undefined}
          className={cn(
            'prose prose-sm dark:prose-invert max-w-none prose-p:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-[14px] leading-relaxed overflow-hidden transition-[max-height] duration-200',
            dimmed ? 'text-muted-foreground' : 'text-foreground/90',
            shouldCollapse && !isExpanded && 'reading-body-collapsed',
          )}
        >
          <MessageResponse className="font-normal prose-strong:font-normal [&_strong]:font-normal [&_b]:font-normal">
            {displayedContent}
          </MessageResponse>
        </div>
        {shouldCollapse && (
          <button data-disclosure-trigger="" aria-expanded={isExpanded}
            type="button"
            onClick={toggleExpand}
            className={cn(
              'mt-2 flex items-center gap-1 text-xs text-foreground/35 transition-colors',
              'hover:text-foreground/55'
            )}
          >
            {isExpanded ? (
              <>
                <DisclosureChevron expanded={isExpanded} size={12} className="size-3" />
                <span>收起</span>
              </>
            ) : (
              <>
                <DisclosureChevron expanded={isExpanded} size={12} className="size-3" />
                <span>展开思考</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function StreamingTextBlock({
  text,
  isStreaming,
  basePath,
  basePaths,
}: {
  text: string
  isStreaming?: boolean
  basePath?: string
  basePaths?: string[]
}): React.ReactElement {
  const { displayedContent } = useSmoothStream({
    content: text,
    isStreaming: isStreaming ?? false,
  })

  return <MessageResponse basePath={basePath} basePaths={basePaths}>{displayedContent}</MessageResponse>
}

// ===== ContentBlock 主组件 =====

export function ContentBlock({ block, allMessages, basePath, basePaths, animate = false, index = 0, dimmed = false, childBlocks, isStreaming }: ContentBlockProps): React.ReactElement | null {
  const timelineBlock = React.useContext(ProcessTimelineContext)
  if (timelineBlock !== null) {
    if (block.type === 'tool_use') {
      return <TimelineToolUseBlock block={block as SDKToolUseBlock} allMessages={allMessages} childBlocks={childBlocks} basePath={basePath} isStreaming={isStreaming} />
    }
    if (block.type === 'thinking' || block.type === 'text') {
      const text = block.type === 'thinking' ? (block as SDKThinkingBlock).thinking : (block as SDKTextBlock).text
      return <ProcessTimelineText text={text} thinking={block.type === 'thinking'} />
    }
  }
  // text 块 — 主要内容，不受 dimmed 影响
  if (block.type === 'text') {
    const textBlock = block as SDKTextBlock
    if (!textBlock.text) return null
    return (
      <StreamingTextBlock
        text={textBlock.text}
        isStreaming={isStreaming}
        basePath={basePath}
        basePaths={basePaths}
      />
    )
  }

  // tool_use 块
  if (block.type === 'tool_use') {
    const toolBlock = block as SDKToolUseBlock
    return (
      <ToolUseBlock
        block={toolBlock}
        allMessages={allMessages}
        animate={animate}
        index={index}
        dimmed={dimmed}
        childBlocks={childBlocks}
        basePath={basePath}
        isStreaming={isStreaming}
      />
    )
  }

  // thinking 块
  if (block.type === 'thinking') {
    const thinkingBlock = block as SDKThinkingBlock
    if (!thinkingBlock.thinking) return null
    return <ThinkingBlock block={thinkingBlock} dimmed={dimmed} isStreaming={isStreaming} />
  }

  return null
}
