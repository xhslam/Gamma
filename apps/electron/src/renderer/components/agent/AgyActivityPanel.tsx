import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowDown, ArrowUp, Check, CircleAlert, Copy, LoaderCircle, Square, Terminal, Wrench } from 'lucide-react'
import type { AgyActivityEvent, AgyTaskStatus } from '@gamma/shared'
import { agyTaskKey, agyTaskViewsAtom, applyAgyTaskUpdateAtom, isAgyTaskActive } from '@/atoms/agy-task-atoms'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { agyEventStateLabel, formatAgyDuration, groupAgyActivity } from '@/lib/agy-activity-presentation'
import { copyTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { clearStopGenerationTarget, rememberStopGenerationTarget } from '@/lib/stop-generation-target'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

const STATUS: Record<AgyTaskStatus, string> = {
  starting: '正在启动', running: '运行中', completed: '已完成', failed: '失败',
  stopping: '正在停止', cancelled: '已取消', timed_out: '已超时', interrupted: '已中断',
}
const EVENT_LABEL: Record<AgyActivityEvent['kind'], string> = {
  init: '任务启动', text: '输出', tool: '工具活动', result: '结果已返回',
  stderr: 'CLI 诊断', unknown: '未知事件', warning: '活动提示',
}
const MARKDOWN_PLUGINS = [remarkGfm]

interface DetailsProps {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}
function Details({ label, children, defaultOpen = false, className }: DetailsProps): React.ReactElement {
  return <Collapsible defaultOpen={defaultOpen} className={cn('group/details min-w-0', className)}>
    <CollapsibleTrigger data-disclosure-trigger="" className="group/disclosure flex min-h-8 w-full items-center gap-2 rounded-md py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <DisclosureChevron size={14} aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-data-[state=open]/disclosure:rotate-90" />
      <span>{label}</span>
    </CollapsibleTrigger>
    <CollapsibleContent className="min-w-0 pb-2 pl-5 pt-2">{children}</CollapsibleContent>
  </Collapsible>
}
function PlainText({ children }: { children: string }): React.ReactElement {
  return <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{children}</pre>
}

/** 外部输出只参与排版：保留原始 HTML 为文字，不加载图片、不激活链接或文件。 */
function OutputText({ children }: { children: string }): React.ReactElement {
  return <div className="prose prose-sm dark:prose-invert min-w-0 max-w-none break-words text-[15px] leading-7 text-foreground [overflow-wrap:anywhere] prose-headings:mb-3 prose-headings:mt-6 prose-headings:font-semibold prose-headings:leading-snug prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:my-3 prose-p:leading-7 prose-strong:font-semibold prose-strong:text-foreground prose-ol:my-3 prose-ol:pl-6 prose-ul:my-3 prose-ul:pl-6 prose-li:my-1.5 prose-li:leading-7 prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-pre:max-w-full prose-pre:overflow-auto prose-pre:rounded-lg prose-pre:bg-muted/50 prose-pre:p-4 prose-pre:text-foreground prose-code:rounded prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.85em] prose-code:text-foreground prose-pre:leading-relaxed prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:p-0 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
    <Markdown remarkPlugins={MARKDOWN_PLUGINS} components={{
      a: ({ children: text }) => <span className="underline decoration-border underline-offset-4">{text}</span>,
      img: ({ alt }) => <span className="text-muted-foreground">[图片：{alt || '未加载'}]</span>,
      table: ({ children: content }) => <div className="max-w-full overflow-x-auto"><table>{content}</table></div>,
    }}>{children}</Markdown>
  </div>
}

function ActivityItem({ event }: { event: AgyActivityEvent }): React.ReactElement {
  if (event.kind === 'text' && event.details === undefined && !event.toolName) return <li className="py-2"><OutputText>{event.text ?? ''}</OutputText></li>
  const issue = event.kind === 'unknown' || event.kind === 'stderr' || event.kind === 'warning' || /^(error|failed)$/i.test(event.state ?? '')
  const Icon = issue ? CircleAlert : event.kind === 'tool' ? Wrench : Terminal
  return <li className="min-w-0 py-1">
    <div className={cn('flex min-w-0 items-start gap-2 py-1 text-xs', issue ? 'text-foreground' : 'text-muted-foreground')}>
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{event.toolName || EVENT_LABEL[event.kind]}{event.state && <span className="ml-2 text-muted-foreground">{agyEventStateLabel(event.state)}</span>}</span>
      <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </div>
    {event.text && <div className="py-1 pl-5"><OutputText>{event.text}</OutputText></div>}
    {event.kind === 'unknown' && <p className="pl-5 text-xs leading-relaxed text-muted-foreground">未知事件，无法保证活动记录完整。</p>}
    {event.kind === 'tool' && <span className="sr-only">仅展示 CLI 上报字段；未提供的输出不可从状态推断。</span>}
    {event.details !== undefined && <Details label="参数与结果详情" className="pl-5"><PlainText>{JSON.stringify(event.details, null, 2)}</PlainText></Details>}
  </li>
}

/** 以连续正文展示输出，CLI 活动与最终结果始终使用各自的数据源。 */
export function AgyActivityPanel({ sessionId, taskId }: { sessionId: string; taskId: string }): React.ReactElement {
  const views = useAtomValue(agyTaskViewsAtom)
  const apply = useSetAtom(applyAgyTaskUpdateAtom)
  const view = views.get(agyTaskKey(sessionId, taskId))
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [copying, setCopying] = React.useState(false)
  const [nextSequence, setNextSequence] = React.useState<number | undefined>()
  const [pages, setPages] = React.useState(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const followRef = React.useRef(true)
  const [newActivity, setNewActivity] = React.useState(false)
  const [showActivity, setShowActivity] = React.useState<boolean | null>(null)
  const events = React.useMemo(() => groupAgyActivity(view?.events ?? []), [view?.events])
  const active = !!view && isAgyTaskActive(view.task)
  const hasResult = !!view?.task.response || view?.task.structuredOutput !== undefined
  const activityOpen = showActivity ?? !hasResult
  const previousHasResult = React.useRef(hasResult)
  React.useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    // 最终结果出现时从正文开头阅读；用户翻阅历史时保持位置。
    if (followRef.current) element.scrollTop = hasResult && (!previousHasResult.current || !active) ? 0 : element.scrollHeight
    else setNewActivity(true)
    previousHasResult.current = hasResult
  }, [view?.events.length, view?.task.lastSequence, hasResult, active])
  const generation = React.useRef(0)
  const inFlight = React.useRef(false)
  const lastReadCursor = React.useRef(0)
  const read = React.useCallback(async (afterSequence = 0): Promise<void> => {
    if (inFlight.current) return
    const requestGeneration = generation.current
    inFlight.current = true
    lastReadCursor.current = afterSequence
    setLoading(true)
    setError(null)
    try {
      const snapshot = await window.electronAPI.readAgyTask(sessionId, taskId, afterSequence)
      if (generation.current !== requestGeneration) return
      apply({ task: snapshot.task, events: snapshot.events, source: 'snapshot' })
      setNextSequence(snapshot.nextSequence)
      setPages(count => count + 1)
    } catch (cause) {
      if (generation.current === requestGeneration) setError(cause instanceof Error ? cause.message : '读取活动失败')
    } finally {
      if (generation.current === requestGeneration) { setLoading(false); inFlight.current = false }
    }
  }, [apply, sessionId, taskId])
  React.useEffect(() => {
    generation.current += 1
    inFlight.current = false
    followRef.current = true
    setPages(0)
    setNextSequence(undefined)
    setShowActivity(null)
    setNewActivity(false)
    setCopied(false)
    setCopying(false)
    setStopping(false)
    void read()
    return () => { generation.current += 1; inFlight.current = false; clearStopGenerationTarget({ kind: 'agy', sessionId, taskId }) }
  }, [read, sessionId, taskId])
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const stop = async (): Promise<void> => {
    if (stopping) return
    const requestGeneration = generation.current
    setStopping(true)
    setError(null)
    try { apply({ task: await window.electronAPI.stopAgyTask(sessionId, taskId), events: [] }) }
    catch (cause) { if (generation.current === requestGeneration) setError(cause instanceof Error ? cause.message : '停止任务失败') }
    finally { if (generation.current === requestGeneration) setStopping(false) }
  }
  const copyResult = async (): Promise<void> => {
    if (copying || !view) return
    const requestGeneration = generation.current
    setCopying(true)
    try {
      await copyTextToClipboard(view.task.response || JSON.stringify(view.task.structuredOutput, null, 2))
      if (generation.current === requestGeneration) setCopied(true)
    } catch (cause) { if (generation.current === requestGeneration) setError(cause instanceof Error ? cause.message : '复制失败') }
    finally { if (generation.current === requestGeneration) setCopying(false) }
  }
  const duration = formatAgyDuration(view?.task.durationSeconds)
  const notices = events.filter(event => event.kind === 'unknown' || event.kind === 'warning' || event.kind === 'stderr' || /^(error|failed)$/i.test(event.state ?? '')).length
  const StatusIcon = active ? LoaderCircle : view?.task.status === 'completed' ? Check : CircleAlert
  return <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" aria-label="agy 活动面板"
    onPointerDownCapture={() => rememberStopGenerationTarget({ kind: 'agy', sessionId, taskId })}
    onFocusCapture={() => rememberStopGenerationTarget({ kind: 'agy', sessionId, taskId })}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Terminal aria-hidden="true" className="size-3.5 shrink-0" /><span className="font-medium text-foreground">agy</span><span className="truncate">外部 Agent</span></div>
      <div className="flex shrink-0 items-center gap-3">
        {view && <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusIcon aria-hidden="true" className={cn('size-3.5', active && 'animate-spin motion-reduce:animate-none')} />{STATUS[view.task.status]}</span>}
        {active && <Button variant="outline" size="sm" disabled={stopping || view?.task.status === 'stopping'} onClick={() => void stop()}><Square aria-hidden="true" className="!size-3" />停止任务</Button>}
      </div>
    </header>
    <div ref={scrollRef} data-testid="agy-scroll" className="min-h-0 flex-1 overflow-y-auto px-5 py-6 scrollbar-thin" onScroll={() => {
      const element = scrollRef.current
      if (!element) return
      followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
      if (followRef.current) setNewActivity(false)
    }}>
      <div className="mx-auto w-full max-w-[65ch] space-y-5">
        {error && <div className="space-y-2"><p role="alert" className="break-words text-xs text-destructive">{error}</p>{!loading && <Button variant="outline" size="sm" onClick={() => void read(lastReadCursor.current)}>重试读取</Button>}</div>}
        {view && <>
          <h3 className="break-words text-sm font-medium leading-relaxed text-muted-foreground">{view.task.title}</h3>
          {view.task.permissionMode && /bypass|danger|skip|full|unrestricted/i.test(view.task.permissionMode) && <p role="alert" className="flex items-start gap-2 text-xs leading-relaxed text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />CLI 报告了宽松权限模式，请核查 agy 自有配置。</p>}
          {view.task.outputIncomplete && <p role="alert" className="text-xs leading-relaxed text-destructive">最终结果不完整，不能按完整成功结果交付。</p>}
          {view.task.error && <p role="alert" className="whitespace-pre-wrap break-words text-xs leading-relaxed text-destructive">{view.task.error}</p>}
          {hasResult && <article aria-label="最终结果" className="space-y-5">
            {view.task.response && <OutputText>{view.task.response}</OutputText>}
            {view.task.structuredOutput !== undefined && <Details label="结构化最终结果" defaultOpen><PlainText>{JSON.stringify(view.task.structuredOutput, null, 2)}</PlainText></Details>}
          </article>}
          <Collapsible open={activityOpen} onOpenChange={setShowActivity} className="group/activity">
            <CollapsibleTrigger data-disclosure-trigger="" className="flex min-h-8 w-full items-center gap-2 rounded-md text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <DisclosureChevron size={14} aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-data-[state=open]/activity:rotate-90" />
              <span>执行过程</span><span className="text-muted-foreground/70">{view.events.length} 条活动{duration ? ` · ${duration}` : ''}</span>
              {notices > 0 && <span className="ml-auto flex shrink-0 items-center gap-1"><CircleAlert aria-hidden="true" className="size-3" />{notices} 条提示</span>}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              {(view.clipped || view.task.truncated) && <p className="mb-3 text-xs text-muted-foreground">活动记录已截断；本面板最多保留最近 2000 条事件。</p>}
              <ol aria-label="CLI 活动时间线" className="space-y-3">{events.map(event => <ActivityItem key={event.sequence} event={event} />)}</ol>
              {!events.length && !loading && <p className="py-4 text-sm text-muted-foreground">{active ? '等待 agy 返回输出…' : '尚无 CLI 活动。'}</p>}
              {nextSequence !== undefined && pages < 10 && <Button variant="ghost" size="sm" className="mt-3" disabled={loading} onClick={() => void read(nextSequence)}>加载更多活动</Button>}
              {nextSequence !== undefined && pages >= 10 && <p className="mt-3 text-xs text-muted-foreground">已达到本次查看的分页上限（2000 条）。</p>}
            </CollapsibleContent>
          </Collapsible>
          {!active && !hasResult && <p className="text-xs text-muted-foreground">{loading ? '正在读取任务记录…' : '此任务未返回独立最终结果，以上为 CLI 上报的执行过程。'}</p>}
          {active && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />{view.task.status === 'stopping' ? '正在等待任务停止…' : 'agy 正在处理…'}</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
            {hasResult && <Button variant="ghost" size="icon-sm" disabled={copying} onClick={() => void copyResult()} title={copied ? '已复制结果' : '复制结果'} aria-label={copied ? '已复制结果' : '复制结果'}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>}
            {duration && <span className="text-xs tabular-nums text-muted-foreground">{duration}</span>}
          </div>
          <Details label="任务信息" className="!mt-2">
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs leading-relaxed">
              <dt className="text-muted-foreground">模型</dt><dd className="break-all">{view.task.model || 'CLI 默认'}</dd>
              <dt className="text-muted-foreground">权限</dt><dd className="break-all">{view.task.permissionMode || '等待 CLI 上报'}</dd>
              <dt className="text-muted-foreground">目录</dt><dd className="break-all font-mono">{view.task.cwd}</dd>
            </dl>
            <div className="mt-4 space-y-1">
              <Details label="任务提示词"><PlainText>{view.task.prompt}</PlainText></Details>
              {view.task.usage && <Details label="用量"><PlainText>{JSON.stringify(view.task.usage, null, 2)}</PlainText></Details>}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">仅展示 CLI 上报活动，不是完整系统审计。权限受 agy 自有配置影响；关闭标签不会停止任务。</p>
          </Details>
        </>}
        {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />正在加载活动…</p>}
        {!view && !loading && !error && <p className="text-sm text-muted-foreground">暂无任务记录。</p>}
      </div>
    </div>
    {newActivity && <Button variant="secondary" size="sm" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-sm" onClick={() => {
      followRef.current = true
      setNewActivity(false)
      const element = scrollRef.current
      if (element) element.scrollTop = hasResult ? 0 : element.scrollHeight
    }}>{hasResult ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}查看新活动</Button>}
  </section>
}

export function AgyTaskList({ sessionId, onOpen }: { sessionId: string; onOpen: (taskId: string) => void }): React.ReactElement {
  const views = useAtomValue(agyTaskViewsAtom)
  const apply = useSetAtom(applyAgyTaskUpdateAtom)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [refresh, setRefresh] = React.useState(0)
  const [visible, setVisible] = React.useState(50)
  React.useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    setVisible(50)
    void window.electronAPI.listAgyTasks(sessionId).then(tasks => {
      if (!disposed) for (const task of tasks) apply({ task, events: [], source: 'snapshot' })
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '读取任务列表失败') })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [apply, refresh, sessionId])
  const tasks = [...views.values()].filter(view => view.task.sessionId === sessionId).map(view => view.task).sort((a, b) => b.startedAt - a.startedAt)
  return <section aria-label="外部任务列表" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">外部任务 · agy</h3><Button variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)} disabled={loading}>刷新</Button></div>
    {loading && <p role="status" className="text-xs text-muted-foreground">正在加载任务…</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {!loading && !error && tasks.length === 0 && <p className="text-xs text-muted-foreground">本会话尚无外部任务。</p>}
    <ul className="space-y-2">{tasks.slice(0, visible).map(task => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)} className="w-full rounded-md border border-border p-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-primary"><span className="block break-words text-xs font-medium">{task.title}</span><span className="text-[11px] text-muted-foreground">{STATUS[task.status]} · {new Date(task.startedAt).toLocaleString()}</span></button></li>)}</ul>
    {tasks.length > visible && <Button variant="outline" size="sm" onClick={() => setVisible(count => count + 50)}>显示更多任务</Button>}
  </section>
}
