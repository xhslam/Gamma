/**
 * ConversationReferenceDialog — 会话引用多选选择器
 *
 * 两级结构（项目 -> 对话），当前项目优先展示，支持跨项目搜索与多选。
 * 支持键盘导航（上下光标仅在会话项间移动、Enter 切换选择、Esc 关闭）。
 * 展示会话标题、更新时间、消息数与首句预览，支持加载态与失败优雅降级。
 * 限制最多同时引用 5 个会话，杜绝自引用与重复引用。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  Search,
  X,
  MessageSquareText,
  Check,
  FolderGit2,
  Loader2,
} from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { isImeKeyboardEvent } from '@/lib/ime-keyboard-policy'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { agentSessionsAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import {
  MAX_CONTEXT_REFS,
  type AgentContextRef,
  type AgentContextRefDetail,
  type AgentSessionMeta,
} from '@gamma/shared'
import { toast } from 'sonner'
import { FadeTitle } from '@/components/ui/fade-title'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

export interface ConversationReferenceDialogProps {
  embedded?: boolean
  anchorRef?: React.RefObject<HTMLElement>
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSessionId: string
  currentWorkspaceId?: string
  initialRefs: AgentContextRef[]
  onConfirm: (refs: AgentContextRef[]) => void | Promise<void>
}

interface ReferenceGroup {
  id: string
  title: string
  isCurrent: boolean
  sessions: AgentSessionMeta[]
  expanded: boolean
}

/** 格式化更新相对时间 */
function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

export function ConversationReferenceDialog({
  embedded = false,
  anchorRef,
  open,
  onOpenChange,
  currentSessionId,
  currentWorkspaceId,
  initialRefs,
  onConfirm,
}: ConversationReferenceDialogProps): React.ReactElement {
  const descriptionId = React.useId()
  const allSessions = useAtomValue(agentSessionsAtom)
  const allWorkspaces = useAtomValue(agentWorkspacesAtom)

  const [retryDetails, setRetryDetails] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [projectFilter, setProjectFilter] = React.useState('*')
  const [expandedProjects, setExpandedProjects] = React.useState<Set<string>>(new Set())
  const [selectedMap, setSelectedMap] = React.useState<Map<string, AgentContextRef>>(new Map())
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1)
  const [detailsCache, setDetailsCache] = React.useState<Record<string, AgentContextRefDetail>>({})
  const [loadingDetails, setLoadingDetails] = React.useState<Record<string, boolean>>({})
  const [errorDetails, setErrorDetails] = React.useState<Record<string, boolean>>({})
  const listRef = React.useRef<HTMLDivElement>(null)

  // 对话框打开时同步初始引用
  React.useEffect(() => {
    if (open) {
      setQuery('')
      setProjectFilter('*')
      setExpandedProjects(new Set())
      setHighlightedIndex(-1)
      const map = new Map<string, AgentContextRef>()
      for (const ref of initialRefs) {
        map.set(ref.sourceConversationId, { ...ref })
      }
      setSelectedMap(map)
    }
  }, [open, initialRefs])

  // 过滤可引用会话（排除当前会话、草稿会话）
  const eligibleSessions = React.useMemo(() => {
    return allSessions.filter((s) => s.id !== currentSessionId && !s.isDraft && !s.archived)
  }, [allSessions, currentSessionId])

  const detailsCacheRef = React.useRef(detailsCache)
  detailsCacheRef.current = detailsCache

  // 全量/分批异步加载会话详情（支持超过30条，杜绝仅截断30条的问题）
  React.useEffect(() => {
    if (!open) return
    let active = true

    const missing = eligibleSessions.filter(
      (s) => !detailsCacheRef.current[s.id]
    )

    if (missing.length === 0) return

    setErrorDetails({})
    // 标记当前批次为加载中
    setLoadingDetails((prev) => {
      const next = { ...prev }
      for (const s of missing) {
        next[s.id] = true
      }
      return next
    })

    const batchSize = 10
    const fetchInBatches = async () => {
      for (let i = 0; i < missing.length; i += batchSize) {
        if (!active) break
        const batch = missing.slice(i, i + batchSize)
        const results = await Promise.all(
          batch.map(async (s) => {
            try {
              const res = await window.electronAPI.getContextRefDetail({ sourceSessionId: s.id })
              return { id: s.id, detail: res.detail, ok: true }
            } catch {
              return { id: s.id, detail: undefined, ok: false }
            }
          })
        )
        if (!active) break

        setDetailsCache((prev) => {
          const next = { ...prev }
          for (const r of results) {
            if (r.ok && r.detail) {
              next[r.id] = r.detail
            }
          }
          return next
        })

        setLoadingDetails((prev) => {
          const next = { ...prev }
          for (const r of results) {
            delete next[r.id]
          }
          return next
        })

        setErrorDetails((prev) => {
          const next = { ...prev }
          for (const r of results) {
            if (!r.ok) {
              next[r.id] = true
            }
          }
          return next
        })
      }
    }

    void fetchInBatches()

    return () => {
      active = false
    }
  }, [open, eligibleSessions, retryDetails])

  const workspaceMap = React.useMemo(() => new Map(allWorkspaces.map((ws) => [ws.id, ws])), [allWorkspaces])
  const normalizedQuery = query.trim().toLowerCase()

  // 搜索的展开状态仅为派生展示，清空搜索后恢复用户原来的折叠选择。
  const groups = React.useMemo(() => {
    const grouped = new Map<string, AgentSessionMeta[]>()
    for (const session of eligibleSessions) {
      const id = session.workspaceId ?? ''
      if (projectFilter !== '*' && id !== projectFilter) continue
      const workspace = workspaceMap.get(id)
      if (normalizedQuery && ![
        session.title, workspace?.name, detailsCache[session.id]?.firstMessagePreview,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery))) continue
      const sessions = grouped.get(id) ?? []
      sessions.push(session)
      grouped.set(id, sessions)
    }
    return [...grouped].map(([id, sessions]): ReferenceGroup => ({
      id,
      title: id ? workspaceMap.get(id)?.name ?? '其他项目' : '默认空间',
      isCurrent: id === (currentWorkspaceId ?? ''),
      sessions: [...sessions].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
      expanded: Boolean(normalizedQuery) || expandedProjects.has(id),
    })).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
  }, [eligibleSessions, projectFilter, normalizedQuery, workspaceMap, detailsCache, currentWorkspaceId, expandedProjects])

  const visibleSessions = React.useMemo(() => groups.flatMap((group) => group.expanded ? group.sessions : []), [groups])
  const sessionIndex = React.useMemo(() => new Map(visibleSessions.map((session, index) => [session.id, index])), [visibleSessions])

  React.useEffect(() => {
    setHighlightedIndex((index) => visibleSessions.length ? Math.min(Math.max(index, 0), visibleSessions.length - 1) : -1)
  }, [visibleSessions])

  const setProjectExpanded = (id: string, expanded: boolean): void => {
    setExpandedProjects((previous) => {
      const next = new Set(previous)
      if (expanded) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // 仅处理结果行和搜索框，避免吞掉项目、模式及底部按钮的原生键盘行为。
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (isImeKeyboardEvent(event.nativeEvent)) return
    const element = event.target instanceof HTMLElement ? event.target : null
    if (!element || element.closest('button, select')) return
    const row = element.closest<HTMLElement>('[data-flat-index]')
    if (!row && element.tagName !== 'INPUT') return
    const index = row ? Number(row.dataset.flatIndex) : highlightedIndex
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!visibleSessions.length) {
        listRef.current?.querySelector<HTMLButtonElement>('[data-reference-project]')?.focus()
        return
      }
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + visibleSessions.length) % visibleSessions.length
      setHighlightedIndex(next)
      if (row) listRef.current?.querySelector<HTMLElement>(`[data-flat-index="${next}"]`)?.focus()
    } else if (event.key === 'Enter' || (event.key === ' ' && row)) {
      event.preventDefault()
      const session = visibleSessions[index]
      if (session) toggleSelection(session)
    } else if (event.key === 'ArrowLeft' && row && !normalizedQuery) {
      event.preventDefault()
      const session = visibleSessions[index]
      if (session) {
        const id = session.workspaceId ?? ''
        listRef.current?.querySelector<HTMLButtonElement>(`[data-reference-project="${CSS.escape(id)}"]`)?.focus()
        setProjectExpanded(id, false)
      }
    }
  }

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-flat-index="${highlightedIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // 切换选择
  const toggleSelection = (session: AgentSessionMeta): void => {
    const isSelected = selectedMap.has(session.id)
    if (isSelected) {
      setSelectedMap((prev) => {
        const next = new Map(prev)
        next.delete(session.id)
        return next
      })
    } else {
      if (selectedMap.size >= MAX_CONTEXT_REFS) {
        toast.warning(`最多同时引用 ${MAX_CONTEXT_REFS} 个对话`)
        return
      }

      const detail = detailsCache[session.id]
      const newRef: AgentContextRef = {
        refId: `ref-${crypto.randomUUID()}`,
        sourceConversationId: session.id,
        sourceProjectId: session.workspaceId ?? '',
        titleAtAttach: session.title || '无标题对话',
        mode: 'snapshot',
        snapshotUpToMessageId: detail?.lastCompleteMessageId,
        snapshotAt: Date.now(),
        messageCount: detail?.messageCount,
        estTokens: detail?.estTokens,
      }

      setSelectedMap((prev) => {
        const next = new Map(prev)
        next.set(session.id, newRef)
        return next
      })
    }
  }

  // 切换模式（快照 / 实时）
  const toggleMode = (sessionId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    const existing = selectedMap.get(sessionId)
    if (!existing) return
    const nextMode = existing.mode === 'live' ? 'snapshot' : 'live'
    setSelectedMap((prev) => {
      const next = new Map(prev)
      next.set(sessionId, { ...existing, mode: nextMode })
      return next
    })
  }

  // 确认保存
  const handleConfirm = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await onConfirm(Array.from(selectedMap.values()))
      onOpenChange(false)
    } catch {
      // 调用方已显示持久化错误；保留选择，允许重试。
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = selectedMap.size

  const renderSession = (session: AgentSessionMeta): React.ReactElement => {
    const index = sessionIndex.get(session.id) ?? -1
    const currentRef = selectedMap.get(session.id)
    const selected = Boolean(currentRef)
    const detail = detailsCache[session.id]
    return (
      <div
        key={session.id}
        data-flat-index={index}
        role="option"
        aria-selected={selected}
        tabIndex={0}
        onClick={() => toggleSelection(session)}
        onFocus={() => setHighlightedIndex(index)}
        onMouseEnter={() => setHighlightedIndex(index)}
        className={cn(
          'group flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-left cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset',
          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
          highlightedIndex === index && !selected && 'bg-muted/50',
        )}
      >
        <span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center rounded border transition-colors', selected ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/35 group-hover:border-muted-foreground/60')}>
          {selected && <Check className="size-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <FadeTitle as="div" className="truncate text-xs">{session.title || '无标题对话'}</FadeTitle>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
            {loadingDetails[session.id] ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
            <span className={cn('truncate', errorDetails[session.id] && 'text-destructive')}>
              {errorDetails[session.id] ? '详情加载失败' : detail?.firstMessagePreview || (loadingDetails[session.id] ? '正在加载详情…' : '暂无文本预览')}
            </span>
            {detail?.messageCount != null && <span className="hidden shrink-0 text-muted-foreground/70 sm:inline">{detail.messageCount} 条消息</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          {currentRef && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`切换引用模式：${session.title || '无标题对话'}`} onClick={(event) => toggleMode(session.id, event)}
                  className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  {currentRef.mode === 'live' ? '实时' : '快照'}
                </button>
              </TooltipTrigger>
              <TooltipContent>{currentRef.mode === 'live' ? '每轮读取最新消息' : '冻结在当前消息，内容保持稳定'}{detail?.estTokens ? ` · 约 ${detail.estTokens} tokens` : ''}</TooltipContent>
            </Tooltip>
          )}
          <span className="text-[11px] text-muted-foreground/70">{formatTimeAgo(session.updatedAt)}</span>
        </div>
      </div>
    )
  }

  const content = (
    <>
        <div className="shrink-0 border-b border-border/50 px-2 py-2 text-left">
          {!embedded && (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2 text-[11px] font-medium text-foreground"><MessageSquareText className="size-3.5" />引用对话</span>
            <button data-icon-button="true" type="button" aria-label="关闭" onClick={() => onOpenChange(false)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" /></button>
          </div>
          )}
          <p id={descriptionId} className="sr-only">选择历史对话作为背景资料，源对话不会被修改。</p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative min-w-0 basis-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、对话或内容…" className="h-7 rounded-md border-border/60 bg-muted/30 pl-9 pr-8 text-xs focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:ring-offset-0" autoFocus />
              {query && <button data-icon-button="true" type="button" aria-label="清空搜索" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"><X className="size-3" /></button>}
            </div>
            <select aria-label="筛选项目" value={projectFilter} onChange={(event) => {
              setProjectFilter(event.target.value)
              if (event.target.value !== '*') setProjectExpanded(event.target.value, true)
            }} className="h-7 min-w-0 max-w-[120px] rounded-md border border-border/60 bg-muted/30 px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
              <option value="*">全部项目</option>
              {[...allWorkspaces].sort((a, b) => Number(b.id === currentWorkspaceId) - Number(a.id === currentWorkspaceId)).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              <option value="">默认空间</option>
            </select>
          </div>
        </div>

        {Object.keys(errorDetails).length > 0 && <button type="button" className="mx-2 my-2 shrink-0 text-left text-xs text-destructive hover:underline" onClick={() => setRetryDetails((value) => value + 1)}>部分详情加载失败，点击重试</button>}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" data-reference-list>
          {!groups.length ? (
            <div role="status" className="flex h-full min-h-24 flex-col items-center justify-center gap-2 py-6 text-center text-muted-foreground">
              <MessageSquareText className="size-6 opacity-40" />
              <p className="text-sm">未找到匹配的对话</p>
              <p className="text-xs">试试其他关键词，或切换项目。</p>
            </div>
          ) : groups.map((group) => {
            const count = group.sessions.filter((session) => selectedMap.has(session.id)).length
            return (
              <Collapsible key={group.id} open={group.expanded} onOpenChange={(expanded) => setProjectExpanded(group.id, expanded)} className="py-0.5">
                <CollapsibleTrigger asChild>
                  <button data-disclosure-trigger="" aria-expanded={group.expanded} type="button" data-reference-project={group.id} disabled={Boolean(normalizedQuery)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                        event.preventDefault()
                        if (!normalizedQuery) setProjectExpanded(group.id, event.key === 'ArrowRight')
                      } else if (event.key === 'ArrowDown' && group.expanded) {
                        event.preventDefault()
                        event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-flat-index]')?.focus()
                      }
                    }}
                    className="flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-default disabled:hover:bg-transparent">
                    <DisclosureChevron expanded={group.expanded} size={14} className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', group.expanded && 'rotate-90')} />
                    <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <FadeTitle className="min-w-0 flex-1 truncate text-xs font-medium">{group.title}</FadeTitle>
                    {group.isCurrent && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">当前项目</span>}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count ? `已选 ${count} · ` : ''}{group.sessions.length}</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div role="listbox" aria-label={`${group.title}的对话`} aria-multiselectable="true" className="mb-2 ml-3 space-y-0.5 border-l border-border/60 pl-2 sm:ml-4">
                    {group.sessions.map(renderSession)}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>

        <div className="flex items-center justify-between shrink-0 gap-2 border-t border-border/50 px-2 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <span data-reference-count className="shrink-0 font-medium tabular-nums text-foreground">已选 {selectedCount} / {MAX_CONTEXT_REFS}</span>
            <span className="hidden truncate text-[11px] min-[600px]:inline">展开项目选择对话 · Esc 关闭</span>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 px-2 text-[11px]">取消</Button>
            <Button type="button" size="sm" onClick={handleConfirm} disabled={saving} className="h-7 px-2 text-[11px]">{saving ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : null}确定引用{selectedCount ? ` (${selectedCount})` : ''}</Button>
          </div>
        </div>
    </>
  )

  if (embedded) return <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>{content}</div>

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorRef ? <PopoverAnchor virtualRef={anchorRef} /> : <PopoverAnchor />}
      <PopoverContent side="top" align="start" sideOffset={8} aria-label="引用对话" aria-describedby={descriptionId}
        className="flex w-[400px] max-w-[calc(100vw-32px)] max-h-[min(360px,var(--radix-popover-content-available-height))] flex-col gap-0 overflow-hidden p-0"
        onKeyDown={handleKeyDown}>{content}</PopoverContent>
    </Popover>
  )
}
