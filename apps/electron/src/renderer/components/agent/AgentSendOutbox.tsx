import { RotateCcw, TriangleAlert } from 'lucide-react'
import type { AgentSendOutboxEntry } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { getQueuedMessageDisplayParts } from '@/lib/agent-message-queue'

interface AgentSendOutboxProps {
  entries: AgentSendOutboxEntry[]
  error: string | null
  busyId: string | null
  disabled: boolean
  onRetry: (entry: AgentSendOutboxEntry) => void
  onRestore: (entry: AgentSendOutboxEntry) => void
  onRefresh: () => void
}

export function AgentSendOutbox({ entries, error, busyId, disabled, onRetry, onRestore, onRefresh }: AgentSendOutboxProps): React.ReactElement | null {
  if (!entries.length && !error) return null
  return (
    <section aria-label="待恢复消息" className="mx-3 mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-xs">
      <div role="status" className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        <span>{error ? '待恢复消息读取失败，原文件已保留' : `${entries.length} 条消息已暂存本地，可跨重启恢复`}</span>
        {error && <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>重新读取</Button>}
      </div>
      {!!entries.length && <ul className="mt-1 max-h-44 space-y-1.5 overflow-y-auto" aria-label="暂存消息列表">
        {entries.map((entry) => {
          const preview = getQueuedMessageDisplayParts(entry.draft.text).map((part) => part.type === 'text' ? part.value : `[${part.label}]`).join('')
          return <li key={entry.id} className="rounded-md bg-background/60 p-2">
            <p className="line-clamp-2 whitespace-pre-wrap break-words text-foreground">{preview || '附件消息'}</p>
            <p className="mt-1 text-muted-foreground">{entry.status === 'failed' ? '提交失败' : '发送结果待确认'}{entry.draft.attachments.length ? ` · ${entry.draft.attachments.length} 个附件` : ''} · 重试使用原渠道与模型，不影响当前草稿</p>
            {entry.error && <p className="mt-1 line-clamp-2 break-words text-muted-foreground">{entry.error}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={disabled || busyId !== null} onClick={() => onRetry(entry)}><RotateCcw className="size-3" aria-hidden />{busyId === entry.id ? '正在重试…' : '重试发送'}</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled || busyId !== null} onClick={() => onRestore(entry)}>追加到输入框</Button>
            </div>
          </li>
        })}
      </ul>}
    </section>
  )
}
