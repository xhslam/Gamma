import type { MarkdownOutlineEntry } from './markdown-reading-tools'
import { Button } from '../ui/button'
interface Props { entries: MarkdownOutlineEntry[]; onJump: (entry: MarkdownOutlineEntry) => void }
export function MarkdownOutline({ entries, onJump }: Props): React.ReactElement {
  return <aside className="w-44 shrink-0 overflow-auto border-r p-2" aria-label="文档目录"><div className="px-2 py-1 text-xs font-medium text-muted-foreground">目录</div>
    {entries.length === 0 ? <p className="p-2 text-xs text-muted-foreground">暂无标题</p> : entries.map(entry => <Button key={entry.offset} variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs" style={{ paddingLeft: 8 + (entry.depth - 1) * 10 }} onClick={() => onJump(entry)}>{entry.text || '未命名标题'}</Button>)}
  </aside>
}
