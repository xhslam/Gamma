import * as React from 'react'
import type { FileAccessOptions } from '@carpus/shared'
import { BrowserSlot } from '@/components/browser/BrowserSlot'

interface HtmlFilePreviewProps {
  sessionId: string
  previewId: string
  filePath: string
  access: FileAccessOptions
  focused: boolean
  fallbackUrl: string
  title: string
}

export function HtmlFilePreview({ sessionId, previewId, filePath, access, focused, fallbackUrl, title }: HtmlFilePreviewProps): React.ReactElement {
  const [guest, setGuest] = React.useState<string | null | undefined>(undefined)

  React.useEffect(() => {
    let cancelled = false
    let tabId: string | null = null
    const open = window.electronAPI.openFilePreviewGuest
    const close = (id: string) => { void window.electronAPI.closeFilePreviewGuest(sessionId, id).catch(() => undefined) }
    if (!open) { setGuest(null); return }
    void open(sessionId, previewId, filePath, access).then(id => {
      tabId = id
      if (!cancelled) setGuest(id)
      else if (id) close(id)
    }).catch(() => { if (!cancelled) setGuest(null) })
    return () => {
      cancelled = true
      if (tabId) close(tabId)
    }
  }, [sessionId, previewId, filePath, access])

  if (guest === undefined) return <div className="p-4 text-xs text-muted-foreground" role="status">正在加载 HTML 预览…</div>
  if (guest === null) return <iframe src={fallbackUrl} className="h-full w-full border-0 bg-card" title={title} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" />
  return <div className="flex h-full min-h-0 flex-col"><BrowserSlot sessionId={sessionId} tabId={guest} filePreviewFocused={focused} title={title} /></div>
}
