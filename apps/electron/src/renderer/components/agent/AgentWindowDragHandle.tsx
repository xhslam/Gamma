import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PanelsTopLeft } from 'lucide-react'
import { toast } from 'sonner'

interface Point { x: number; y: number }

/** 单独的拖拽手柄不干扰会话标题菜单及侧栏的会话引用拖拽。 */
export function AgentWindowDragHandle({ sessionId, title }: { sessionId: string; title: string }): React.ReactElement | null {
  const gesture = useRef<{ pointer: number; origin: Point; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<Point | null>(null)
  const open = (fromDrag: boolean): void => {
    void window.electronAPI.detachAgentWindow(sessionId, fromDrag).catch(() => toast.error('无法打开独立任务窗口'))
  }

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !gesture.current) return
      event.stopPropagation()
      event.preventDefault()
      suppressClick.current = true
      gesture.current = null
      setPreview(null)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [])

  if (!window.electronAPI.detachAgentWindow) return null
  return <>
    <button
      type="button"
      aria-label="在新窗口打开会话"
      title="拖出窗口以拆分会话，或点击在新窗口打开"
      className="titlebar-no-drag relative inline-flex size-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        suppressClick.current = false
        gesture.current = { pointer: event.pointerId, origin: { x: event.clientX, y: event.clientY }, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = gesture.current
        if (!drag || drag.pointer !== event.pointerId) return
        if (Math.hypot(event.clientX - drag.origin.x, event.clientY - drag.origin.y) >= 7) drag.moved = true
        if (drag.moved) setPreview({ x: event.clientX, y: event.clientY })
      }}
      onPointerUp={(event) => {
        const drag = gesture.current
        if (!drag || drag.pointer !== event.pointerId) return
        gesture.current = null
        suppressClick.current = drag.moved
        setPreview(null)
        if (drag.moved) open(true)
      }}
      onLostPointerCapture={() => {
        if (!gesture.current) return
        suppressClick.current = true
        gesture.current = null
        setPreview(null)
      }}
      onClick={(event) => { if (event.detail === 0 || !suppressClick.current) open(false) }}
    >
      <PanelsTopLeft className="size-3.5" aria-hidden="true" />
    </button>
    {preview && createPortal(
      <div aria-hidden="true" className="pointer-events-none fixed z-[9999]" style={{
        left: Math.min(Math.max(preview.x + 14, 8), Math.max(window.innerWidth - 248, 8)),
        top: Math.min(Math.max(preview.y + 14, 8), Math.max(window.innerHeight - 70, 8)),
      }}>
        <div className="flex w-60 items-center gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150">
          <PanelsTopLeft className="size-4 shrink-0" />
          <div className="min-w-0"><div className="truncate text-sm font-medium">{title}</div><div className="text-xs text-muted-foreground">拖出窗口后松开</div></div>
        </div>
      </div>, document.body,
    )}
  </>
}
