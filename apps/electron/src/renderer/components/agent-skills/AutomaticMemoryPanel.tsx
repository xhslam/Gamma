import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ArrowLeft, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react'
import type { AutomaticMemoryCategory, AutomaticMemoryEntry, AutomaticMemorySettings, AutomaticMemorySnapshot } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { automaticMemoryChangesAtom, automaticMemoryNavigationAtom, automaticMemoryPanelStateAtomFamily } from '@/atoms/automatic-memory-atoms'
import { AUTOMATIC_MEMORY_CATEGORIES, filterAutomaticMemoryEntries } from '@/lib/automatic-memory-presentation'
import { useAutomaticMemoryChanges } from '@/hooks/useAutomaticMemoryChanges'
import { cn } from '@/lib/utils'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

interface AutomaticMemoryPanelProps {
  workspaceSlug: string
  entryId?: string
}

const triggerClass = 'rounded-lg outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40'

export function AutomaticMemoryPanel({ workspaceSlug, entryId }: AutomaticMemoryPanelProps): React.ReactElement {
  useAutomaticMemoryChanges()
  const changes = useAtomValue(automaticMemoryChangesAtom)
  const navigation = useAtomValue(automaticMemoryNavigationAtom)
  const [view, setView] = useAtom(automaticMemoryPanelStateAtomFamily(workspaceSlug))
  const focusedId = entryId ?? (navigation?.workspaceSlug === workspaceSlug ? navigation.entryId : undefined)
  const [snapshot, setSnapshot] = React.useState<AutomaticMemorySnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<AutomaticMemoryEntry | null>(null)
  const [editRevision, setEditRevision] = React.useState(0)
  const [deleteRevision, setDeleteRevision] = React.useState(0)
  const [text, setText] = React.useState('')
  const [deleting, setDeleting] = React.useState<AutomaticMemoryEntry | null>(null)
  const generation = React.useRef(0)
  const panelRef = React.useRef<HTMLElement>(null)
  const focusRequest = React.useRef<{ id: string; navigation: typeof navigation } | null>(null)
  const pendingFocus = React.useRef(false)
  const latestChange = changes.filter((change) => change.workspaceSlug === workspaceSlug).at(-1)
  const refresh = React.useCallback(async (): Promise<void> => {
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const next = await window.electronAPI.getAutomaticMemorySnapshot(workspaceSlug)
      if (request === generation.current) setSnapshot(next)
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : '加载分类记忆失败')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [workspaceSlug])
  React.useEffect(() => {
    setSelectedId(null)
    setSnapshot(null)
    setEditing(null)
    setDeleting(null)
    focusRequest.current = null
    void refresh()
    return () => { generation.current++ }
  }, [refresh])
  React.useEffect(() => { if (latestChange) void refresh() }, [latestChange, refresh])

  // 深链接必须先解除筛选并展开全部祖先；普通刷新不重置用户的浏览状态。
  React.useEffect(() => {
    if (!focusedId || !snapshot || loading) return
    if (focusRequest.current?.id === focusedId && focusRequest.current.navigation === navigation) return
    const entry = snapshot.entries.find((item) => item.id === focusedId)
    setSelectedId(entry?.id ?? null)
    focusRequest.current = { id: focusedId, navigation }
    pendingFocus.current = Boolean(entry)
    setView((previous) => ({
      ...previous,
      open: true,
      query: '',
      collapsedCategories: entry ? previous.collapsedCategories.filter((key) => key !== entry.category) : previous.collapsedCategories,
      expandedEntries: entry ? [...new Set([...previous.expandedEntries, entry.id])] : previous.expandedEntries,
    }))
  }, [focusedId, snapshot, loading, navigation, setView])
  React.useEffect(() => {
    if (!pendingFocus.current || !focusedId || loading || !view.open || view.query || !view.expandedEntries.includes(focusedId)) return
    const frame = requestAnimationFrame(() => {
      const target = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-memory-entry-id]') ?? [])
        .find((element) => element.dataset.memoryEntryId === focusedId)
      if (!target || target.getBoundingClientRect().height === 0) return
      pendingFocus.current = false
      target.scrollIntoView({ block: 'nearest' })
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedId, loading, view.open, view.expandedEntries, view.query, view.collapsedCategories, navigation])

  const mutate = async (operation: () => Promise<unknown>, closeEditor = true): Promise<void> => {
    const request = generation.current
    setBusy(true)
    setError(null)
    try {
      await operation()
      if (request !== generation.current) return
      if (closeEditor) setEditing(null)
      setDeleting(null)
      await refresh()
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : '保存失败，请刷新后重试；编辑内容已保留。')
    } finally {
      setBusy(false)
    }
  }
  const updateSettings = (patch: Partial<AutomaticMemorySettings>): void => {
    void mutate(() => window.electronAPI.updateAutomaticMemorySettings(workspaceSlug, patch), false)
  }
  const entries = snapshot?.entries ?? []
  const filtered = filterAutomaticMemoryEntries(entries, view.query)
  const searching = Boolean(view.query.trim())
  const selected = entries.find((entry) => entry.id === selectedId)
  const openEntry = (entry: AutomaticMemoryEntry, edit = false): void => {
    if (!snapshot) return
    setSelectedId(entry.id)
    if (edit) {
      setEditing(entry)
      setEditRevision(snapshot.revision)
      setText(entry.content)
    }
  }

  return (
    <section ref={panelRef} aria-label="自动分类记忆" className="min-w-0 overflow-hidden rounded-xl bg-background text-foreground">
      <Collapsible open={view.open} onOpenChange={(open) => setView((previous) => ({ ...previous, open }))}>
        <div className="flex items-center gap-2 px-4 py-3">
          <CollapsibleTrigger asChild>
            <button type="button" aria-label={view.open ? '折叠记忆面板' : '展开记忆面板'} className={cn(triggerClass, 'flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium')}>
              <span className="flex-1">记忆</span>
              <DisclosureChevron expanded={view.open} size={14} />
            </button>
          </CollapsibleTrigger>
          <Button size="icon-sm" variant="ghost" aria-label="刷新记忆" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw className={cn(loading && 'animate-spin motion-reduce:animate-none')} /></Button>
        </div>
        {error && <div role="alert" className="mx-4 mb-3 rounded-lg bg-destructive/5 p-3 text-xs text-destructive"><p className="break-words">{error}</p><Button size="sm" variant="ghost" onClick={() => void refresh()}>重新加载（保留编辑）</Button></div>}
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <div className="px-4 pb-4">
            {loading && <p role="status" className="py-3 text-sm text-muted-foreground">加载记忆中…</p>}
            {busy && <p role="status" className="py-2 text-xs text-muted-foreground">正在保存更改…</p>}
            {selected && snapshot ? (
              <article data-memory-entry-id={selected.id} tabIndex={-1} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                <Button aria-label="返回记忆列表" variant="ghost" size="sm" className="mb-4 -ml-2 gap-2" onClick={() => setSelectedId(null)}><ArrowLeft size={14} />记忆</Button>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">{selected.title}</h3>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => openEntry(selected, true)}>编辑</Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setDeleting(selected); setDeleteRevision(snapshot.revision) }}>删除</Button>
                  </div>
                </div>
                <dl className="mt-4 space-y-6 text-sm">
                  <div><dt className="mb-2 text-xs text-muted-foreground">上次更新</dt><dd>{new Date(selected.updatedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</dd></div>
                  <div><dt className="mb-2 text-xs text-muted-foreground">详情</dt><dd className="whitespace-pre-wrap break-words leading-7 [overflow-wrap:anywhere]">{selected.content}</dd></div>
                </dl>
                {selected.manuallyEdited && <p className="mt-4 text-xs text-muted-foreground">手动保护 · 自动生成不会覆盖此条目</p>}
              </article>
            ) : <>
              <div className="divide-y divide-border/40">
                <div className="flex items-center justify-between gap-6 py-4">
                  <div><label htmlFor={`automatic-memory-${workspaceSlug}`} className="text-sm">从对话生成记忆</label><p className="mt-1 text-xs leading-5 text-muted-foreground">仅从新对话中提取，保存在当前工作区。</p></div>
                  <Switch id={`automatic-memory-${workspaceSlug}`} checked={snapshot?.settings.enabled ?? false} disabled={busy || loading || !snapshot} onCheckedChange={(enabled) => updateSettings({ enabled })} />
                </div>
                <div className="flex items-center justify-between gap-6 py-4">
                  <div><label htmlFor={`sensitive-memory-${workspaceSlug}`} className="text-sm">在记忆中包含敏感话题</label><p className="mt-1 text-xs leading-5 text-muted-foreground">独立授权，默认关闭；关闭不会删除已有内容。</p></div>
                  <Switch id={`sensitive-memory-${workspaceSlug}`} checked={snapshot?.settings.includeSensitive ?? false} disabled={busy || loading || !snapshot} onCheckedChange={(includeSensitive) => updateSettings({ includeSensitive })} />
                </div>
              </div>
              <p className="mb-6 text-xs leading-5 text-muted-foreground">开启后使用当前渠道模型处理本次用户文本及相关记忆，不扫描历史会话；敏感开关只控制保存，不会在发送模型前自动脱敏。请勿输入凭据。</p>
              {snapshot && <>
                {entries.length > 0 && <div className="mb-4 flex items-center gap-3">
                  <div className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索记忆" placeholder="搜索记忆…" value={view.query} onChange={(event) => setView((previous) => ({ ...previous, query: event.target.value }))} className="h-8 pl-9 pr-8 text-xs" />{view.query && <Button size="icon-sm" variant="ghost" aria-label="清空搜索" className="absolute right-0 top-0" onClick={() => setView((previous) => ({ ...previous, query: '' }))}><X /></Button>}</div>
                  <span role="status" className="shrink-0 text-xs text-muted-foreground">{searching ? `${filtered.length} / ${entries.length}` : `${entries.length} 条`}</span>
                </div>}
                {focusedId && !entries.some((entry) => entry.id === focusedId) && <p role="status" className="py-3 text-xs text-muted-foreground">此条记忆已删除或不再可用。</p>}
                {filtered.length === 0 ? <div className="py-8 text-center"><p className="text-sm">{searching ? '没有找到匹配的记忆' : '还没有保存的记忆'}</p><p className="mt-2 text-xs text-muted-foreground">{searching ? '试试其他关键词，或清空搜索查看全部。' : '开启自动生成后，从新对话中逐步积累协作信息。'}</p></div> :
                  <div className="space-y-6">{AUTOMATIC_MEMORY_CATEGORIES.map((category) => {
                    const items = filtered.filter((entry) => entry.category === category.key)
                    if (!items.length) return null
                    return <div key={category.key} data-memory-category={category.key}>
                      <h3 className="mb-2 text-sm font-medium">{category.key === 'profile' ? '您' : category.label}</h3>
                      <div className="divide-y divide-border/40 border-t border-border/40">{items.map((entry) => <div key={entry.id} data-memory-entry-id={entry.id} className="group flex min-w-0 items-center gap-2 rounded-lg hover:bg-muted/60 focus-within:bg-muted/60">
                        <button type="button" aria-label={`查看 ${entry.title}`} onClick={() => openEntry(entry)} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-4 px-3 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_7rem]">
                          <span className="truncate">{entry.title}</span><span className="truncate text-muted-foreground">{entry.content.replace(/\s+/g, ' ')}</span><time className="hidden text-xs text-muted-foreground lg:block" dateTime={new Date(entry.updatedAt).toISOString()}>更新于 {new Date(entry.updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</time>
                        </button>
                        <div className="flex shrink-0 pr-1 opacity-100 transition-opacity motion-reduce:transition-none sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <Button size="icon-sm" variant="ghost" aria-label={`编辑 ${entry.title}`} disabled={busy} onClick={() => openEntry(entry, true)}><Pencil className="!size-3.5" /></Button>
                          <Button size="icon-sm" variant="ghost" aria-label={`删除 ${entry.title}`} disabled={busy} onClick={() => { setDeleting(entry); setDeleteRevision(snapshot.revision) }}><Trash2 className="!size-3.5" /></Button>
                        </div>
                      </div>)}</div>
                    </div>
                  })}</div>}
              </>}
            </>}
            {editing && <div className="sticky bottom-0 mt-6 border-t border-border/40 bg-background pt-4">
              <label className="mb-2 block text-xs text-muted-foreground" htmlFor={`memory-edit-${workspaceSlug}`}>编辑 {editing.title}</label>
              <Textarea id={`memory-edit-${workspaceSlug}`} autoFocus aria-label={`编辑 ${editing.title}`} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} className="min-h-28 rounded-xl text-sm leading-relaxed" />
              <div className="mt-3 flex items-center gap-2"><Button size="sm" disabled={busy || !text.trim()} onClick={() => void mutate(() => window.electronAPI.editAutomaticMemoryEntry(workspaceSlug, editing.id, text, editRevision))}>保存并保护</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>取消编辑</Button></div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">保存后自动生成不会覆盖此条目；并发修改会拒绝保存，请复制修改并刷新。</p>
            </div>}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null) }}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader><AlertDialogTitle className="text-sm">删除此记忆？</AlertDialogTitle><AlertDialogDescription>“{deleting?.title}”将从记忆中移除，自动抽取不会重新恢复该主题。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} className="border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20" onClick={(event) => { event.preventDefault(); if (deleting) void mutate(() => window.electronAPI.deleteAutomaticMemoryEntry(workspaceSlug, deleting.id, deleteRevision), editing?.id === deleting.id) }}>确认删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
