import * as React from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { constrainImageTransform, INITIAL_IMAGE_TRANSFORM, MAX_IMAGE_SCALE, zoomImageAt } from '@/lib/image-viewport'
import type { ImageTransform } from '@/lib/image-viewport'
import { cn } from '@/lib/utils'
import { iconButtonNoRingFocusClass } from './icon-button-styles'

interface ImageLightboxPreviewProps { src: string; alt?: string; children: React.ReactNode }

/** 仅在预览期间挂载。切图、关闭与编辑会销毁手势和监听器，不影响编辑器坐标。 */
export function ImageLightboxPreview({ src, alt, children }: ImageLightboxPreviewProps): React.ReactElement {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const imageRef = React.useRef<HTMLImageElement>(null)
  const transformRef = React.useRef<ImageTransform>(INITIAL_IMAGE_TRANSFORM)
  const dragRef = React.useRef<{ id: number; x: number; y: number } | null>(null)
  const [transform, setTransform] = React.useState(INITIAL_IMAGE_TRANSFORM)
  const [dragging, setDragging] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const update = React.useCallback((value: ImageTransform): void => {
    transformRef.current = value
    setTransform(value)
  }, [])
  const cancelDrag = React.useCallback((): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && stageRef.current?.hasPointerCapture(drag.id)) stageRef.current.releasePointerCapture(drag.id)
    setDragging(false)
  }, [])
  const reset = React.useCallback((): void => { cancelDrag(); update(INITIAL_IMAGE_TRANSFORM) }, [cancelDrag, update])
  const zoom = React.useCallback((scale: number, client?: { x: number; y: number }): void => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image || !image.naturalWidth) return
    const rect = stage.getBoundingClientRect()
    update(zoomImageAt(transformRef.current, scale, client ? { x: client.x - rect.left - rect.width / 2, y: client.y - rect.top - rect.height / 2 } : { x: 0, y: 0 }, { width: image.offsetWidth, height: image.offsetHeight }, { width: stage.clientWidth, height: stage.clientHeight }))
  }, [update])

  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      // 归一化行/页滚轮，触控板连续滚动也以指针为锚点。
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1
      zoom(transformRef.current.scale * Math.exp(-event.deltaY * unit * 0.002), { x: event.clientX, y: event.clientY })
    }
    stage.addEventListener('wheel', wheel, { passive: false })
    const observer = new ResizeObserver(reset)
    observer.observe(stage)
    return () => {
      stage.removeEventListener('wheel', wheel)
      observer.disconnect()
      const drag = dragRef.current
      dragRef.current = null
      if (drag && stage.hasPointerCapture(drag.id)) stage.releasePointerCapture(drag.id)
    }
  }, [reset, zoom])

  const buttonClass = cn('rounded-full p-1.5 text-inverse-foreground/80 hover:bg-card/15 hover:text-inverse-foreground focus-visible:bg-card/15 disabled:opacity-40', iconButtonNoRingFocusClass)
  return (
    <div className="flex flex-col items-center">
      <div
        ref={stageRef}
        data-image-viewport
        className="flex h-[78vh] w-[90vw] items-center justify-center overflow-hidden touch-none select-none"
        style={{ cursor: transform.scale > 1 ? dragging ? 'grabbing' : 'grab' : 'default' }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || transformRef.current.scale <= 1 || dragRef.current) return
          event.preventDefault()
          dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          const stage = stageRef.current
          const image = imageRef.current
          if (!drag || drag.id !== event.pointerId || !stage || !image) return
          update(constrainImageTransform({ ...transformRef.current, x: transformRef.current.x + event.clientX - drag.x, y: transformRef.current.y + event.clientY - drag.y }, { width: image.offsetWidth, height: image.offsetHeight }, { width: stage.clientWidth, height: stage.clientHeight }))
          drag.x = event.clientX
          drag.y = event.clientY
        }}
        onPointerUp={cancelDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onDoubleClick={(event) => zoom(transformRef.current.scale > 1 ? 1 : 2, { x: event.clientX, y: event.clientY })}
      >
        <img ref={imageRef} src={src} alt={alt || '预览图片'} draggable={false}
          onLoad={() => { setLoaded(true); reset() }} onError={() => { setFailed(true); reset() }}
          className="max-h-full max-w-full shrink-0 rounded-lg object-contain shadow-2xl"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, visibility: failed ? 'hidden' : undefined }}
        />
        {failed && <p role="status" className="absolute text-inverse-foreground">图片加载失败</p>}
      </div>
      <div className="mt-3 flex items-center gap-0.5 rounded-full bg-overlay/50 px-3 py-2.5 shadow-lg backdrop-blur-md">
        {children}
        <div className="mx-1.5 h-5 w-px bg-card/20" aria-hidden />
        <button data-icon-button="true" data-icon-button-tone="inverse" type="button" aria-label="缩小图片" title="缩小图片" className={buttonClass} disabled={!loaded || transform.scale <= 1} onClick={() => zoom(transformRef.current.scale / 1.25)}><Minus className="size-5" /></button>
        <button type="button" aria-label="重置图片缩放" title="重置图片缩放" className={cn(buttonClass, 'min-w-16 text-xs tabular-nums')} onClick={reset}>{Math.round(transform.scale * 100)}%</button>
        <button data-icon-button="true" data-icon-button-tone="inverse" type="button" aria-label="放大图片" title="放大图片" className={buttonClass} disabled={!loaded || transform.scale >= MAX_IMAGE_SCALE} onClick={() => zoom(transformRef.current.scale * 1.25)}><Plus className="size-5" /></button>
        <button data-icon-button="true" data-icon-button-tone="inverse" type="button" aria-label="适应窗口" title="适应窗口" className={buttonClass} onClick={reset}><RotateCcw className="size-5" /></button>
      </div>
    </div>
  )
}
