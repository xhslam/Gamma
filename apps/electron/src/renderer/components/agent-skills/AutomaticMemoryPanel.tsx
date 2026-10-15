import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { AutomaticMemoryEntry, AutomaticMemorySettings, AutomaticMemorySnapshot } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { automaticMemoryChangesAtom, automaticMemoryNavigationAtom } from '@/atoms/automatic-memory-atoms'
import { AUTOMATIC_MEMORY_CATEGORIES } from '@/lib/automatic-memory-presentation'
import { useAutomaticMemoryChanges } from '@/hooks/useAutomaticMemoryChanges'

interface AutomaticMemoryPanelProps {
  workspaceSlug: string
  entryId?: string
}

export function AutomaticMemoryPanel({ workspaceSlug, entryId }: AutomaticMemoryPanelProps): React.ReactElement {
  useAutomaticMemoryChanges()
  const changes = useAtomValue(automaticMemoryChangesAtom)
  const navigation = useAtomValue(automaticMemoryNavigationAtom)
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
    void refresh()
    return () => { generation.current++ }
  }, [refresh])
  React.useEffect(() => { if (latestChange) void refresh() }, [latestChange, refresh])
  const panelRef = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    if (!focusedId || loading) return
    const target = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-memory-entry-id]') ?? [])
      .find((element) => element.dataset.memoryEntryId === focusedId)
    target?.scrollIntoView({ block: 'nearest' })
    target?.focus({ preventScroll: true })
  }, [focusedId, loading, snapshot])

  const mutate = async (operation: () => Promise<unknown>): Promise<void> => {
    const request = generation.current
    setBusy(true)
    setError(null)
    try {
      await operation()
      if (request !== generation.current) return
      setEditing(null)
      setDeleting(null)
      await refresh()
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : '保存失败，请刷新后重试；编辑内容已保留。')
    } finally {
      setBusy(false)
    }
  }
  const updateSettings = (patch: Partial<AutomaticMemorySettings>): void => {
    void mutate(() => window.electronAPI.updateAutomaticMemorySettings(workspaceSlug, patch))
  }

  return (
    <section ref={panelRef} aria-label="自动分类记忆" className="space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">自动分类记忆</h2>
        <Button size="sm" variant="ghost" disabled={busy || loading} onClick={() => void refresh()}>刷新</Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        默认关闭。开启后，将调用当前渠道的模型，发送本次用户文本及相关已有记忆用于抽取；不会扫描历史会话。记忆保存在当前工作区。
      </p>
      {error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>重新加载（保留编辑）</Button>
        </div>
      )}
      {loading && <p role="status" className="text-xs text-muted-foreground">加载分类记忆中…</p>}
      {snapshot && (
        <>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`automatic-memory-${workspaceSlug}`} className="text-sm">自动生成记忆</label>
            <Switch
              id={`automatic-memory-${workspaceSlug}`}
              checked={snapshot.settings.enabled}
              disabled={busy || loading}
              onCheckedChange={(enabled) => updateSettings({ enabled })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`sensitive-memory-${workspaceSlug}`} className="text-sm">允许保存敏感信息</label>
            <Switch
              id={`sensitive-memory-${workspaceSlug}`}
              checked={snapshot.settings.includeSensitive}
              disabled={busy || loading}
              onCheckedChange={(includeSensitive) => updateSettings({ includeSensitive })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            敏感记忆独立授权，默认关闭；此开关控制保存，不会在发送模型前自动脱敏，也不会删除已保存的内容。请勿输入凭据。手动编辑后，该条目将受自动更新保护。
          </p>
          {focusedId && !snapshot.entries.some((entry) => entry.id === focusedId) && (
            <p role="status" className="text-xs text-muted-foreground">此条记忆已删除或不再可用。</p>
          )}
          {AUTOMATIC_MEMORY_CATEGORIES.map((category) => {
            const entries = snapshot.entries.filter((entry) => entry.category === category.key)
            return (
              <div key={category.key} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">{category.label}</h3>
                {entries.length === 0 && <p className="text-xs text-muted-foreground">暂无记忆</p>}
                {entries.map((entry) => (
                  <article
                    key={entry.id}
                    tabIndex={-1}
                    data-memory-entry-id={entry.id}
                    className={`rounded-lg border p-3 outline-none focus:ring-2 focus:ring-ring ${focusedId === entry.id ? 'border-ring' : 'border-border'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium">{entry.title}</h4>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || Boolean(editing && editing.id !== entry.id)}
                          onClick={() => {
                            setEditing(entry)
                            setEditRevision(snapshot.revision)
                            setText(entry.content)
                          }}
                        >编辑</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(entry)
                            setDeleteRevision(snapshot.revision)
                          }}
                        >删除</Button>
                      </div>
                    </div>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      更新于 {new Date(entry.updatedAt).toLocaleString()} · {entry.manuallyEdited ? '手动编辑 · 自动更新已保护' : '自动生成'}
                    </p>
                    {editing?.id === entry.id ? (
                      <div className="space-y-2">
                        <Textarea
                          aria-label={`编辑 ${entry.title}`}
                          value={text}
                          onChange={(event) => setText(event.target.value)}
                          disabled={busy}
                        />
                        <p className="text-xs text-muted-foreground">保存后自动生成不会覆盖此条目；并发修改会拒绝保存，请复制修改并刷新。</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busy || !text.trim()}
                            onClick={() => void mutate(() => window.electronAPI.editAutomaticMemoryEntry(workspaceSlug, editing.id, text, editRevision))}
                          >保存并保护</Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(null)}>取消</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.content}</p>
                    )}
                  </article>
                ))}
              </div>
            )
          })}
        </>
      )}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
            <AlertDialogDescription>删除“{deleting?.title}”后，自动抽取不会重新恢复该主题。此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                if (deleting) void mutate(() => window.electronAPI.deleteAutomaticMemoryEntry(workspaceSlug, deleting.id, deleteRevision))
              }}
            >确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
