import * as React from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { isImeKeyEvent } from './vmark/utils/imeGuard'
interface Props {
  query: string; onQuery: (query: string) => void; count: number; index: number
  onNext: (delta: number) => void; editing: boolean; onReplace: (replacement: string, all: boolean) => void; onClose: () => void
}
export function MarkdownFindBar(props: Props): React.ReactElement {
  const [replacement, setReplacement] = React.useState('')
  const composing = React.useRef(false)
  const compositionEndedAt = React.useRef(0)
  return <div className="flex shrink-0 flex-wrap items-center gap-1 border-b p-2" aria-label="Markdown 查找替换" onCompositionStartCapture={() => { composing.current = true }} onCompositionEndCapture={() => { composing.current = false; compositionEndedAt.current = Date.now() }}>
    <Input className="h-7 w-36 text-xs" autoFocus aria-label="查找文本" placeholder="查找文本" value={props.query} onChange={event => props.onQuery(event.target.value)} onKeyDown={event => {
      if (isImeKeyEvent(event.nativeEvent) || composing.current || Date.now() - compositionEndedAt.current <= 50) return
      if (event.key === 'Enter') { event.preventDefault(); props.onNext(event.shiftKey ? -1 : 1) }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onClose() }
    }} />
    <span className="text-[10px] text-muted-foreground">源码 {props.count ? props.index % props.count + 1 : 0}/{props.count}</span>
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => props.onNext(-1)}>上一项</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => props.onNext(1)}>下一项</Button>
    {props.editing && <><Input className="h-7 w-28 text-xs" aria-label="替换文本" placeholder="替换为" value={replacement} onChange={event => setReplacement(event.target.value)} /><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!props.query} onClick={() => props.onReplace(replacement, false)}>替换</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!props.query} onClick={() => props.onReplace(replacement, true)}>全部替换</Button></>}
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={props.onClose} aria-label="关闭查找">×</Button>
  </div>
}
