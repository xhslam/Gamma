import * as React from 'react'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKToolUseBlock,
  SDKToolResultBlock,
} from '@carpus/shared'
import type { TurnFileChangeSummary, TurnFileChangesResult } from '@carpus/shared'
import { ChevronDown, ChevronUp, FileDiff, Undo2 } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { agentDiffRefreshVersionAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { activeOnDemandOverlayAtom } from '@/atoms/on-demand-base-atoms'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { useMessageSessionId } from '@/components/ai-elements/message'

const COLLAPSED_FILE_LIMIT = 3
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * 本轮"触碰过"的工具集合（改 + 读）——用于正文内联文件引用的路径补全，比 MUTATING_TOOLS 更宽。
 * Read 的 input.file_path 与 Edit/Write 同构，都是绝对路径，可零解析纳入映射。
 * Grep/Glob 的 input 只有 pattern、命中文件仅存在于 tool_result 中，暂不纳入。
 * 底部文件改动卡片只收集修改工具。
 */
const TOUCHED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'])

function getFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'NotebookEdit') {
    const fp = input.notebook_path
    return typeof fp === 'string' ? fp : null
  }
  const fp = input.file_path ?? input.filePath ?? input.path
  return typeof fp === 'string' ? fp : null
}

function collectFileCalls(turnMessages: SDKMessage[], tools: Set<string> = MUTATING_TOOLS) {
  // 只有已返回且未报错的工具调用才能作为正文文件引用的可信证据。
  // pending tool_use 在流式过程中可能尚未创建文件，不能提前渲染为可点击 Chip。
  const succeeded = new Set<string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const blocks = (msg as SDKUserMessage).message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const rb = block as SDKToolResultBlock
      if (rb.is_error !== true) succeeded.add(rb.tool_use_id)
    }
  }

  const calls: { id: string; path: string }[] = []
  for (const msg of turnMessages) {
    if (msg.type !== 'assistant') continue
    const blocks = (msg as SDKAssistantMessage).message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue
      const tu = block as SDKToolUseBlock
      if (!tools.has(tu.name)) continue
      if (!succeeded.has(tu.id)) continue

      const filePath = getFilePath(tu.name, tu.input as Record<string, unknown>)
      if (filePath) calls.push({ id: tu.id, path: filePath })
    }
  }
  return calls
}

/**
 * 构建「文件名 → 绝对路径」映射，供消息正文内联文件引用补全裸文件名使用。
 * 数据源为本轮"触碰过"的文件（TOUCHED_TOOLS：改过 + Read 读过），比底部改动汇总更宽，
 * 覆盖"本轮只读过没改就在正文引用"的高频场景；拿到的都是绝对路径。
 * 同名不同目录的文件无法凭裸文件名区分，直接从映射中剔除，交由既有 basePaths 解析逻辑处理
 * （不比补全前更差）。
 */
export function buildTurnFileNameMap(turnMessages: SDKMessage[]): Map<string, string> {
  const paths = new Set(collectFileCalls(turnMessages, TOUCHED_TOOLS).map(call => call.path))
  const map = new Map<string, string>()
  const conflicted = new Set<string>()
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop() || p
    if (conflicted.has(name)) continue
    const existing = map.get(name)
    if (existing && existing !== p) {
      map.delete(name)
      conflicted.add(name)
      continue
    }
    map.set(name, p)
  }
  return map
}

interface TurnFileChangesSummaryProps {
  turnMessages: SDKMessage[]
  sessionId?: string
  basePath?: string
}

function pathLabel(path: string, basePath?: string) {
  const normalized = path.replaceAll('\\', '/')
  const prefix = basePath?.replaceAll('\\', '/').replace(/\/+$/, '')
  return prefix && normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length + 1) : normalized
}

function LineCounts({ additions, deletions }: Pick<TurnFileChangeSummary, 'additions' | 'deletions'>) {
  if (additions == null || deletions == null) return null
  return <span className="shrink-0 space-x-1.5 font-mono text-xs tabular-nums" aria-label={`新增 ${additions} 行，删除 ${deletions} 行`}>
    <span className="text-foreground">+{additions}</span><span className="text-destructive">−{deletions}</span>
  </span>
}

export function TurnFileChangesSummary({ turnMessages, sessionId: explicitSessionId, basePath }: TurnFileChangesSummaryProps) {
  // SDKMessage.session_id 是 Pi 内核 ID，文件快照以 Carpus 会话 ID 隔离。
  const messageSessionId = useMessageSessionId()
  const sessionId = explicitSessionId ?? messageSessionId
  const calls = React.useMemo(() => collectFileCalls(turnMessages), [turnMessages])
  const toolKey = JSON.stringify(calls.map(call => call.id))
  const request = React.useMemo(() => ({ sessionId: sessionId ?? '', toolIds: JSON.parse(toolKey) as string[] }), [sessionId, toolKey])
  const [expanded, setExpanded] = React.useState(true)
  const [summary, setSummary] = React.useState<TurnFileChangesResult | null>(null)
  const [undoing, setUndoing] = React.useState(false)
  const [error, setError] = React.useState('')
  const setActiveOverlay = useSetAtom(activeOnDemandOverlayAtom)
  const openPreview = useOpenPreview()
  const refreshChanges = useSetAtom(agentDiffRefreshVersionAtom)
  const listId = React.useId()

  React.useEffect(() => {
    let current = true
    setSummary(null)
    setError('')
    if (request.sessionId && request.toolIds.length && window.electronAPI?.getTurnFileChanges) {
      void window.electronAPI.getTurnFileChanges(request).then(result => {
        if (current) setSummary(result)
      }).catch(() => { /* 历史记录或快照不可用时仍展示文件列表。 */ })
    }
    return () => { current = false }
  }, [request])

  const covered = new Set(summary?.coveredToolIds)
  const files = new Map((summary?.files ?? []).map(file => [pathLabel(file.path, basePath), file]))
  for (const call of calls) {
    const label = pathLabel(call.path, basePath)
    if (!covered.has(call.id) && !files.has(label)) files.set(label, { path: call.path, created: false })
  }
  const entries = [...files]
  if (!entries.length) return null
  const canToggleFiles = entries.length > COLLAPSED_FILE_LIMIT
  const visibleEntries = expanded ? entries : entries.slice(0, COLLAPSED_FILE_LIMIT)
  const hasCounts = entries.every(([, file]) => file.additions != null && file.deletions != null)
  const undo = async () => {
    setUndoing(true)
    setError('')
    try {
      setSummary(await window.electronAPI.undoTurnFileChanges(request))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method .*?: Error: /, '') : '未能撤销本轮修改。')
      await window.electronAPI.getTurnFileChanges(request).then(setSummary).catch(() => {})
    } finally {
      refreshChanges(previous => new Map(previous).set(request.sessionId, (previous.get(request.sessionId) ?? 0) + 1))
      setUndoing(false)
    }
  }
  const preview = (path: string) => {
    if (!sessionId) return
    openPreview(sessionId, { filePath: path, previewOnly: true, basePaths: basePath ? [basePath] : undefined })
  }

  return (
    <div className="mt-1 min-w-0">
      <section aria-label="本轮文件变更" className="overflow-hidden rounded-xl border border-foreground/30 bg-muted/20">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileDiff className="size-4" aria-hidden /></span>
            <div>
              <div className="text-sm font-medium">已编辑 {entries.length} 个文件</div>
              {hasCounts && <LineCounts additions={entries.reduce((sum, [, file]) => sum + file.additions!, 0)} deletions={entries.reduce((sum, [, file]) => sum + file.deletions!, 0)} />}
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            {summary?.undone ? <span role="status" className="px-2 text-xs text-muted-foreground">已撤销</span> : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={undoing || !summary?.canUndo} title={summary?.canUndo ? undefined : '没有完整的本轮文件快照'}>
                    {undoing ? '正在撤销…' : '撤销'} <Undo2 className="size-3.5" aria-hidden />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>撤销本轮文件修改？</AlertDialogTitle>
                    <AlertDialogDescription>恢复本轮编辑前的内容，并移除本轮新建的文件。若文件此后又被修改，Carpus 不会覆盖。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void undo()}>确认撤销</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button size="sm" variant="outline" onClick={() => setActiveOverlay('changes')}>查看变更</Button>
          </div>
        </div>
        {error && <p role="alert" className="break-words border-t border-foreground/20 px-3 py-2 text-xs text-destructive">{error}</p>}
        <ul id={listId} className="border-t border-foreground/20 py-1">
          {visibleEntries.map(([label, file]) => (
            <li key={label}>
              <button type="button" title={`查看文件：${label}`} disabled={!sessionId}
                className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:hover:bg-transparent"
                onClick={() => preview(file.path)}>
                <span className="min-w-0 truncate font-mono text-xs"><span className="text-muted-foreground">{label.slice(0, label.lastIndexOf('/') + 1)}</span>{label.slice(label.lastIndexOf('/') + 1)}</span>
                <LineCounts {...file} />
              </button>
            </li>
          ))}
        </ul>
        {canToggleFiles && (
          <button type="button" aria-expanded={expanded} aria-controls={listId}
            className="flex w-full items-center gap-1.5 border-t border-foreground/20 px-3 py-2 text-xs font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setExpanded(value => !value)}>
            {expanded ? '收起文件' : '展开文件'} {expanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          </button>
        )}
      </section>
    </div>
  )
}
