import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Brain, ChevronDown, ChevronsDownUp, ChevronsUpDown, FolderOpen, LockKeyhole, Pencil, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, UserRound, Users, X } from 'lucide-react'
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

interface AutomaticMemoryPanelProps {
  workspaceSlug: string
  entryId?: string
}

const CATEGORY_ICONS = { profile: UserRound, topics: FolderOpen, areas: SlidersHorizontal, people: Users }
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
  const toggleCategory = (category: AutomaticMemoryCategory, open: boolean): void => {
    setView((previous) => ({ ...previous, collapsedCategories: open
      ? previous.collapsedCategories.filter((key) => key !== category)
      : [...new Set([...previous.collapsedCategories, category])] }))
  }
  const toggleEntry = (id: string, open: boolean): void => {
    setView((previous) => ({ ...previous, expandedEntries: open
      ? [...new Set([...previous.expandedEntries, id])]
      : previous.expandedEntries.filter((key) => key !== id) }))
  }
  const entries = snapshot?.entries ?? []
  const filtered = filterAutomaticMemoryEntries(entries, view.query)
  const searching = Boolean(view.query.trim())
  const allExpanded = entries.length > 0 && view.collapsedCategories.length === 0 && entries.every((entry) => view.expandedEntries.includes(entry.id))

  return (
    <section ref={panelRef} aria-label="自动分类记忆" className="min-w-0 overflow-hidden rounded-2xl border border-border/50 bg-background text-foreground shadow-sm">
      <Collapsible open={view.open} onOpenChange={(open) => setView((previous) => ({ ...previous, open }))}>
        <div className="flex items-center gap-2 p-3">
          <CollapsibleTrigger asChild>
            <button type="button" aria-label={view.open ? '折叠记忆面板' : '展开记忆面板'} className={cn(triggerClass, 'flex min-w-0 flex-1 items-center gap-3 p-1.5 text-left')}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Brain size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold tracking-tight">自动分类记忆</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">工作区</span>
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', snapshot?.settings.enabled ? 'bg-primary' : 'bg-muted-foreground/40')} />
                  {snapshot ? `${entries.length} 条记忆 · ${snapshot.settings.enabled ? '自动生成已开启' : '自动生成已关闭'}` : '了解你的偏好与工作方式'}
                  {editing && <span className="text-primary">· 编辑中</span>}
                </span>
              </span>
              <ChevronDown size={15} className={cn('shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !view.open && '-rotate-90')} />
            </button>
          </CollapsibleTrigger>
          <Button size="icon-sm" variant="ghost" aria-label="刷新记忆" title="刷新记忆" disabled={busy || loading} onClick={() => void refresh()} className="shrink-0 text-muted-foreground">
            <RefreshCw className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
          </Button>
        </div>
        {error && (
          <div role="alert" className="mx-4 mb-3 space-y-2 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
            <p className="break-words">{error}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>重新加载（保留编辑）</Button>
          </div>
        )}
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <div className="space-y-3 border-t border-border/40 px-4 pb-4 pt-3">
            <Collapsible open={view.settingsOpen} onOpenChange={(settingsOpen) => setView((previous) => ({ ...previous, settingsOpen }))} className="rounded-xl bg-muted/35">
              <CollapsibleTrigger asChild>
                <button type="button" aria-label="记忆设置" className={cn(triggerClass, 'flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-muted-foreground')}>
                  <Settings2 size={14} />
                  <span className="flex-1 font-medium text-foreground/80">记忆设置</span>
                  <span className="text-[10px]">{snapshot?.settings.includeSensitive ? '允许敏感信息' : '敏感信息已关闭'}</span>
                  <ChevronDown size={13} className={cn('transition-transform motion-reduce:transition-none', !view.settingsOpen && '-rotate-90')} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                <div className="space-y-3 border-t border-border/40 px-3 pb-3 pt-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor={`automatic-memory-${workspaceSlug}`} className="text-xs font-medium">自动生成记忆</label>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">仅从新对话中提取，保存在当前工作区。</p>
                    </div>
                    <Switch id={`automatic-memory-${workspaceSlug}`} checked={snapshot?.settings.enabled ?? false} disabled={busy || loading || !snapshot} onCheckedChange={(enabled) => updateSettings({ enabled })} />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor={`sensitive-memory-${workspaceSlug}`} className="text-xs font-medium">允许保存敏感信息</label>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">独立授权，默认关闭；关闭不会删除已有内容。</p>
                    </div>
                    <Switch id={`sensitive-memory-${workspaceSlug}`} checked={snapshot?.settings.includeSensitive ?? false} disabled={busy || loading || !snapshot} onCheckedChange={(includeSensitive) => updateSettings({ includeSensitive })} />
                  </div>
                  <div className="space-y-2 border-t border-border/40 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                    <p>自动生成默认关闭。开启后，将调用当前渠道的模型，发送本次用户文本及相关已有记忆用于抽取；不会扫描历史会话。</p>
                    <p className="flex items-start gap-1.5"><LockKeyhole size={12} className="mt-0.5 shrink-0" /><span>敏感开关只控制保存，不会在发送模型前自动脱敏。请勿输入凭据。手动编辑后，该条目将受自动更新保护。</span></p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />加载分类记忆中…</p>}
            {busy && <p role="status" className="text-xs text-muted-foreground">正在保存更改…</p>}
            {snapshot && (
              <>
                {entries.length > 0 && <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-[1_1_180px]">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                    <Input aria-label="搜索记忆" placeholder="搜索标题或内容…" value={view.query} onChange={(event) => setView((previous) => ({ ...previous, query: event.target.value, collapsedCategories: [] }))} className="h-8 rounded-lg pl-8 pr-8 text-xs md:text-xs" />
                    {view.query && <Button size="icon-sm" variant="ghost" aria-label="清空搜索" className="absolute right-0.5 top-0.5 text-muted-foreground" onClick={() => setView((previous) => ({ ...previous, query: '' }))}><X /></Button>}
                  </div>
                  <Button size="sm" variant="ghost" disabled={entries.length === 0} className="h-8 gap-1.5 px-2 text-[11px] text-muted-foreground" onClick={() => setView((previous) => ({ ...previous, collapsedCategories: allExpanded ? AUTOMATIC_MEMORY_CATEGORIES.map((category) => category.key) : [], expandedEntries: allExpanded ? [] : entries.map((entry) => entry.id) }))}>
                    {allExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}{allExpanded ? '全部折叠' : '全部展开'}
                  </Button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{searching ? '搜索结果' : '已保存的记忆'}</span>
                  <span role="status" className="tabular-nums">{searching ? `${filtered.length} / ${entries.length}` : `${entries.length} 条 · ${AUTOMATIC_MEMORY_CATEGORIES.filter((category) => entries.some((entry) => entry.category === category.key)).length} 个分类`}</span>
                </div>
                </>}
                {focusedId && !entries.some((entry) => entry.id === focusedId) && <p role="status" className="text-xs text-muted-foreground">此条记忆已删除或不再可用。</p>}
                {filtered.length === 0 ? (
                  <div className="rounded-xl px-4 py-6 text-center">
                    {searching ? <Search size={24} className="mx-auto mb-3 text-muted-foreground/45" /> : <Brain size={26} className="mx-auto mb-3 text-primary/50" />}
                    <p className="text-sm font-medium">{searching ? '没有找到匹配的记忆' : '还没有保存的记忆'}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{searching ? '试试其他关键词，或清空搜索查看全部。' : snapshot.settings.enabled ? '继续对话后，值得保留的信息会出现在这里。' : '开启自动生成后，从新对话中逐步积累协作信息。'}</p>
                    {!searching && !snapshot.settings.enabled && <Button size="sm" variant="outline" className="mt-4 text-xs" onClick={() => setView((previous) => ({ ...previous, settingsOpen: true }))}>打开记忆设置</Button>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {AUTOMATIC_MEMORY_CATEGORIES.map((category) => {
                      const categoryEntries = filtered.filter((entry) => entry.category === category.key)
                      if (searching && categoryEntries.length === 0) return null
                      const Icon = CATEGORY_ICONS[category.key]
                      const open = categoryEntries.length > 0 && !view.collapsedCategories.includes(category.key)
                      return (
                        <Collapsible key={category.key} data-memory-category={category.key} open={open} onOpenChange={(next) => toggleCategory(category.key, next)}>
                          <CollapsibleTrigger asChild>
                            <button type="button" disabled={categoryEntries.length === 0} className={cn(triggerClass, 'flex w-full items-center gap-2 px-2 py-2 text-left disabled:opacity-45')}>
                              <Icon size={14} className="shrink-0 text-muted-foreground" />
                              <span className="flex-1 text-xs font-medium">{category.label}</span>
                              <span className="min-w-5 rounded-md bg-muted/70 px-1.5 text-center text-[10px] leading-5 tabular-nums text-muted-foreground">{categoryEntries.length}</span>
                              <ChevronDown size={13} className={cn('shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                            <div className="space-y-1.5 pb-1 pt-1">
                              {categoryEntries.map((entry) => (
                                <Collapsible key={entry.id} open={view.expandedEntries.includes(entry.id)} onOpenChange={(next) => toggleEntry(entry.id, next)} asChild>
                                  <article tabIndex={-1} data-memory-entry-id={entry.id} className={cn('min-w-0 rounded-xl border border-border/40 bg-muted/15 outline-none transition-colors focus:ring-2 focus:ring-ring/40', focusedId === entry.id && 'border-primary/30 bg-primary/5')}>
                                    <div className="flex items-start gap-1 p-1.5">
                                      <CollapsibleTrigger asChild>
                                        <button type="button" aria-label={`${view.expandedEntries.includes(entry.id) ? '折叠' : '展开'} ${entry.title}`} className={cn(triggerClass, 'min-w-0 flex-1 px-2 py-1.5 text-left')}>
                                          <span className="flex items-start gap-2">
                                            <ChevronDown size={13} className={cn('mt-0.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !view.expandedEntries.includes(entry.id) && '-rotate-90')} />
                                            <span className="min-w-0 flex-1">
                                              <span className="block truncate text-[13px] font-medium leading-5" title={entry.title}>{entry.title}</span>
                                              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 text-muted-foreground">
                                                <time dateTime={new Date(entry.updatedAt).toISOString()} title={new Date(entry.updatedAt).toLocaleString()}>{new Date(entry.updatedAt).toLocaleDateString()}</time>
                                                <span className={cn('inline-flex items-center gap-1', entry.manuallyEdited && 'text-primary')}>
                                                  {entry.manuallyEdited ? <ShieldCheck size={10} /> : <Sparkles size={10} />}{entry.manuallyEdited ? '手动保护' : '自动生成'}
                                                </span>
                                                {editing?.id === entry.id && <span className="text-primary">编辑中</span>}
                                              </span>
                                              {!view.expandedEntries.includes(entry.id) && <span className="mt-1.5 block truncate text-xs leading-5 text-muted-foreground">{entry.content.replace(/\s+/g, ' ')}</span>}
                                            </span>
                                          </span>
                                        </button>
                                      </CollapsibleTrigger>
                                      <div className="flex shrink-0 gap-0.5 pt-1">
                                        <Button size="icon-sm" variant="ghost" aria-label={`编辑 ${entry.title}`} title="编辑记忆" disabled={busy || Boolean(editing && editing.id !== entry.id)} className="text-muted-foreground hover:text-foreground" onClick={() => {
                                          if (editing?.id === entry.id) { toggleEntry(entry.id, true); return }
                                          setEditing(entry)
                                          setEditRevision(snapshot.revision)
                                          setText(entry.content)
                                          toggleEntry(entry.id, true)
                                        }}><Pencil className="!size-3.5" /></Button>
                                        <Button size="icon-sm" variant="ghost" aria-label={`删除 ${entry.title}`} title="删除记忆" disabled={busy} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => { setDeleting(entry); setDeleteRevision(snapshot.revision) }}><Trash2 className="!size-3.5" /></Button>
                                      </div>
                                    </div>
                                    <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                                      <div className="mx-3 border-t border-border/40 py-3">
                                        {editing?.id === entry.id ? (
                                          <div className="space-y-3">
                                            <Textarea autoFocus aria-label={`编辑 ${entry.title}`} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} className="min-h-28 resize-y text-sm leading-relaxed" />
                                            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck size={12} className="mt-0.5 shrink-0" /><span>保存后自动生成不会覆盖此条目；并发修改会拒绝保存，请复制修改并刷新。</span></p>
                                            <div className="flex flex-wrap gap-2">
                                              <Button size="sm" disabled={busy || !text.trim()} onClick={() => void mutate(() => window.electronAPI.editAutomaticMemoryEntry(workspaceSlug, editing.id, text, editRevision))}>保存并保护</Button>
                                              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(null)}>取消</Button>
                                            </div>
                                          </div>
                                        ) : <p className="whitespace-pre-wrap break-words text-[13px] leading-7 [overflow-wrap:anywhere]">{entry.content}</p>}
                                      </div>
                                    </CollapsibleContent>
                                  </article>
                                </Collapsible>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )
                    })}
                  </div>
                )}
                {entries.length > 0 && <p className="flex items-center gap-1.5 border-t border-border/40 pt-3 text-[10px] text-muted-foreground"><ShieldCheck size={12} className="shrink-0" />你可以随时编辑或删除，手动编辑的条目不会被自动覆盖。</p>}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
            <AlertDialogDescription>删除“{deleting?.title}”后，自动抽取不会重新恢复该主题。此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => {
              event.preventDefault()
              if (deleting) void mutate(() => window.electronAPI.deleteAutomaticMemoryEntry(workspaceSlug, deleting.id, deleteRevision), editing?.id === deleting.id)
            }}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
