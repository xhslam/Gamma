/** 图片位置评论：编号标记与百分比坐标共同交给 Agent，避免模糊的位置描述。 */

import * as React from 'react'
import { Check, MessageSquarePlus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildImageCommentPrompt } from '@/lib/image-editing'
import type { ImageComment } from '@/lib/image-editing'
import { renderImageCommentMarkers } from '@/lib/image-editor-canvas'

interface ImageCommentEditorProps {
  src: string
  onSave: (editedDataUrl: string, prompt: string) => void
  onCancel: () => void
}

const MAX_DIM = 4096

export function ImageCommentEditor({ src, onSave, onCancel }: ImageCommentEditorProps): React.ReactElement {
  const [comments, setComments] = React.useState<ImageComment[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const imageRef = React.useRef<HTMLImageElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<string | null>(null)

  const activeComment = comments.find((comment) => comment.id === activeId) ?? null
  const completedComments = comments.filter((comment) => comment.text.trim())

  React.useEffect(() => {
    setComments([])
    setActiveId(null)
    setLoaded(false)
    setLoadError(false)
  }, [src])

  const pointFromEvent = React.useCallback((event: React.PointerEvent): { x: number, y: number } | null => {
    const image = imageRef.current
    if (!image) return null
    const rect = image.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }, [])

  const addComment = React.useCallback((event: React.MouseEvent<HTMLImageElement>): void => {
    const image = imageRef.current
    if (!image) return
    if (comments.some((comment) => !comment.text.trim())) {
      const empty = comments.find((comment) => !comment.text.trim())
      if (empty) setActiveId(empty.id)
      return
    }
    const rect = image.getBoundingClientRect()
    const comment: ImageComment = {
      id: crypto.randomUUID(),
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      text: '',
    }
    setComments((current) => [...current, comment])
    setActiveId(comment.id)
  }, [comments])

  const updateComment = React.useCallback((id: string, update: Partial<ImageComment>): void => {
    setComments((current) => current.map((comment) => comment.id === id ? { ...comment, ...update } : comment))
  }, [])

  const removeComment = React.useCallback((id: string): void => {
    setComments((current) => current.filter((comment) => comment.id !== id))
    setActiveId((current) => current === id ? null : current)
  }, [])

  const finishComments = React.useCallback(async (): Promise<void> => {
    const image = imageRef.current
    const validComments = comments.filter((comment) => comment.text.trim())
    const prompt = buildImageCommentPrompt(validComments)
    if (!image || !prompt || exporting) return
    setExporting(true)
    try {
      let width = image.naturalWidth
      let height = image.naturalHeight
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(image, 0, 0, width, height)
      renderImageCommentMarkers(ctx, validComments, width, height)
      onSave(canvas.toDataURL('image/png'), prompt)
    } finally {
      setExporting(false)
    }
  }, [comments, exporting, onSave])

  return (
    <div className="flex w-full max-w-[94vw] flex-col items-center gap-3">
      <div ref={containerRef} className="relative flex max-h-[70vh] max-w-[90vw] items-center justify-center">
        {!loaded && !loadError && <div className="h-[150px] w-[200px]" role="status" aria-label="正在加载图片" />}
        {loadError ? (
          <div className="flex flex-col items-center gap-3 text-inverse-foreground/70" role="alert">
            <span className="text-sm">图片加载失败</span>
            <button type="button" onClick={onCancel} className="rounded-full bg-card/10 px-4 py-1.5 text-sm hover:bg-card/20">返回</button>
          </div>
        ) : (
          <img
            ref={imageRef}
            src={src}
            alt="点击添加位置评论"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setLoadError(true)}
            onClick={addComment}
            className={cn('max-h-[70vh] max-w-[90vw] cursor-crosshair select-none rounded-lg object-contain shadow-2xl', !loaded && 'hidden')}
          />
        )}
        {loaded && comments.map((comment) => {
          const completedIndex = completedComments.findIndex((item) => item.id === comment.id)
          const number = completedIndex >= 0 ? completedIndex + 1 : completedComments.length + 1
          return (
            <button
              key={comment.id}
              type="button"
              aria-label={`评论 ${number}，x ${(comment.x * 100).toFixed(1)}%，y ${(comment.y * 100).toFixed(1)}%`}
              onClick={(event) => {
                event.stopPropagation()
                setActiveId(comment.id)
              }}
              onPointerDown={(event) => {
                event.stopPropagation()
                draggingIdRef.current = comment.id
                event.currentTarget.setPointerCapture(event.pointerId)
                setActiveId(comment.id)
              }}
              onPointerMove={(event) => {
                if (draggingIdRef.current !== comment.id) return
                const point = pointFromEvent(event)
                if (point) updateComment(comment.id, point)
              }}
              onPointerUp={(event) => {
                draggingIdRef.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { draggingIdRef.current = null }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.01 : 0.001
                const delta = event.key === 'ArrowLeft' ? { x: -step } : event.key === 'ArrowRight' ? { x: step } : event.key === 'ArrowUp' ? { y: -step } : event.key === 'ArrowDown' ? { y: step } : null
                if (delta) {
                  event.preventDefault()
                  updateComment(comment.id, {
                    x: Math.min(1, Math.max(0, comment.x + (delta.x ?? 0))),
                    y: Math.min(1, Math.max(0, comment.y + (delta.y ?? 0))),
                  })
                } else if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault()
                  removeComment(comment.id)
                }
              }}
              className={cn(
                'absolute z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full border-2 border-border text-sm font-semibold text-inverse-foreground shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                activeId === comment.id ? 'bg-accent' : 'bg-accent/85',
              )}
              style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
            >
              {number}
            </button>
          )
        })}
      </div>

      {comments.length === 0 && loaded && (
        <div className="flex items-center gap-2 rounded-full bg-overlay/50 px-4 py-2 text-xs text-inverse-foreground/70 shadow-lg backdrop-blur-md">
          <MessageSquarePlus className="size-4" />点击图片任意位置添加评论
        </div>
      )}

      {activeComment && (
        <div className="w-full max-w-[680px] rounded-2xl bg-overlay/60 p-3 shadow-lg backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-medium tabular-nums text-inverse-foreground/65">
              评论 {(() => { const index = completedComments.findIndex((comment) => comment.id === activeComment.id); return index >= 0 ? index + 1 : completedComments.length + 1 })()} · x {(activeComment.x * 100).toFixed(1)}% · y {(activeComment.y * 100).toFixed(1)}%
            </span>
            <button type="button" aria-label="删除当前评论" title="删除当前评论" onClick={() => removeComment(activeComment.id)} className="rounded-full p-1.5 text-inverse-foreground/60 hover:bg-card/15 hover:text-inverse-foreground"><Trash2 className="size-4" /></button>
          </div>
          <textarea
            autoFocus
            aria-label="位置评论内容"
            value={activeComment.text}
            onChange={(event) => updateComment(activeComment.id, { text: event.target.value })}
            placeholder="描述这个位置需要怎样修改"
            rows={3}
            className="w-full resize-none rounded-xl border border-card/15 bg-card/10 px-3 py-2 text-sm text-inverse-foreground outline-none placeholder:text-inverse-foreground/40 focus:border-ring/50"
          />
        </div>
      )}

      <div className="flex items-center gap-1 rounded-full bg-overlay/50 px-2 py-2 shadow-lg backdrop-blur-md">
        <button type="button" aria-label="取消评论" title="取消评论" onClick={onCancel} className="rounded-full p-2 text-inverse-foreground/70 hover:bg-card/15 hover:text-inverse-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><X className="size-5" /></button>
        <button
          type="button"
          onClick={finishComments}
          disabled={completedComments.length === 0 || exporting}
          className="flex items-center gap-2 rounded-full bg-card/15 px-4 py-2 text-sm font-medium text-inverse-foreground hover:bg-card/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="size-4" />完成评论
        </button>
      </div>
      <span className="sr-only">编号可拖动，方向键微调 0.1%，按住 Shift 微调 1%。完成后图片和评论会填入当前会话，不会自动发送。</span>
    </div>
  )
}
