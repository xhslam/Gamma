import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { X } from 'lucide-react'
import type { AutomaticMemorySource } from '@gamma/shared'
import { automaticMemoryChangesAtom, automaticMemoryNavigationAtom, dismissedAutomaticMemoryChangesAtom } from '@/atoms/automatic-memory-atoms'
import { useAutomaticMemoryChanges } from '@/hooks/useAutomaticMemoryChanges'
import { automaticMemoryChangeKey, selectAutomaticMemoryChanges } from '@/lib/automatic-memory-presentation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AutomaticMemoryPanel } from './AutomaticMemoryPanel'

interface AutomaticMemoryNoticeProps {
  kind: AutomaticMemorySource['kind']
  sessionId: string
  workspaceSlug?: string
}

/** 消息区域的真实保存结果；只保留本次应用运行期最近 8 项，不假造历史保存卡片。 */
export function AutomaticMemoryNotice({ kind, sessionId, workspaceSlug }: AutomaticMemoryNoticeProps): React.ReactElement | null {
  useAutomaticMemoryChanges()
  const changes = useAtomValue(automaticMemoryChangesAtom)
  const navigate = useSetAtom(automaticMemoryNavigationAtom)
  const [dismissed, setDismissed] = useAtom(dismissedAutomaticMemoryChangesAtom)
  const [selected, setSelected] = React.useState<{ workspaceSlug: string; entryId: string } | null>(null)
  React.useEffect(() => setSelected(null), [kind, sessionId, workspaceSlug])
  const visible = selectAutomaticMemoryChanges(changes, kind, sessionId, workspaceSlug)
    .filter((change) => !dismissed.has(automaticMemoryChangeKey(change)))
  if (visible.length === 0) return null

  return (
    <section aria-label="本会话记忆保存结果" className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-muted/30 px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs leading-4 text-muted-foreground">已保存到工作区记忆 · 本次运行期提示</p>
        <button data-icon-button="true"
          type="button"
          aria-label="关闭记忆保存提示"
          title="关闭提示，不影响已保存的记忆"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setSelected(null)
            setDismissed((previous) => new Set([...previous, ...visible.map(automaticMemoryChangeKey)]))
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div role="status">
        {visible.map((change) => (
          <button
            type="button"
            key={automaticMemoryChangeKey(change)}
            className="block w-full break-words rounded-md py-0.5 text-left text-xs leading-4 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              const target = { workspaceSlug: change.workspaceSlug, entryId: change.entryId }
              navigate(target)
              setSelected(target)
            }}
          >
            {change.action === 'added' ? '已记住' : '已更新'}：{change.title}{' '}
            <span className="text-muted-foreground">· {new Date(change.changedAt).toLocaleTimeString()} · 查看</span>
          </button>
        ))}
      </div>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/40 px-5 py-4 text-left">
            <DialogTitle className="text-base">工作区记忆</DialogTitle>
            <DialogDescription className="text-xs">浏览、整理和管理 Gamma 为你保留的信息。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-4">
            {selected && (
              <AutomaticMemoryPanel key={selected.workspaceSlug} workspaceSlug={selected.workspaceSlug} entryId={selected.entryId} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
