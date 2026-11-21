/**
 * ImageEditor - 图片精准编辑器
 *
 * 底图负责像素编辑，标注保持为可选择对象；裁剪与保存时才合并。
 * 支持画笔、文字、形状、局部擦除、背景移除、比例裁剪、旋转和完整历史记录。
 */

import * as React from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Crop,
  Eraser,
  ImageMinus,
  Link2,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCw,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { readDesignColor } from '@/lib/design-colors'
import { renderImageAnnotation } from '@/lib/image-editor-canvas'
import {
  IMAGE_ASPECT_RATIOS,
  calculateCenteredAspectCrop,
  cloneImageAnnotations,
  getAnnotationBounds,
  hitTestAnnotation,
  removeBackgroundAt,
  removeEdgeBackground,
  translateAnnotation,
} from '@/lib/image-editing'
import type {
  ImageAnnotation,
  ImageAspectRatio,
  ImagePoint,
  ImageRect,
} from '@/lib/image-editing'

export type ImageEditorTool = 'select' | 'draw' | 'text' | 'rect' | 'ellipse' | 'arrow' | 'erase' | 'background' | 'crop' | 'resize'

type Operation = 'annotation' | 'erase' | 'move' | 'crop' | null

interface ImageEditorProps {
  src: string
  initialTool?: ImageEditorTool
  /** 弹窗按视口布局；侧边栏按可用容器尺寸布局。 */
  layout?: 'lightbox' | 'inline'
  onSave: (editedDataUrl: string) => void | Promise<void>
  onCancel: () => void
  /** 文件预览覆盖保存时保持扩展名与实际编码一致。 */
  outputMimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
}

interface EditorSnapshot {
  image: string
  annotations: ImageAnnotation[]
  rotation: number
}

interface TextDraft {
  id?: string
  x: number
  y: number
  value: string
}

interface MoveState {
  id: string
  start: ImagePoint
  original: ImageAnnotation
  moved: boolean
}

interface EditorButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

const MAX_DIM = 4096
const MAX_RESIZE_DIM = 8192
const MAX_RESIZE_PIXELS = 40_000_000
const HISTORY_LIMIT = 30
const DRAW_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827'] as const
const BRUSH_SIZES = [3, 6, 12]
const TEXT_SIZES = [24, 36, 48]

function EditorButton({ label, active, className, children, ...props }: EditorButtonProps): React.ReactElement {
  return (
    <button
      data-icon-button="true"
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'rounded-full p-2 text-inverse-foreground/70 transition-colors duration-150',
        'hover:bg-card/15 hover:text-inverse-foreground focus-visible:bg-card/15 focus-visible:text-inverse-foreground',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-30',
        active && 'bg-card/20 text-inverse-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function normalizedRect(rect: ImageRect): ImageRect {
  return { x: Math.min(rect.x, rect.x + rect.w), y: Math.min(rect.y, rect.y + rect.h), w: Math.abs(rect.w), h: Math.abs(rect.h) }
}

export function ImageEditor({ src, initialTool = 'select', layout = 'lightbox', onSave, onCancel, outputMimeType = 'image/png' }: ImageEditorProps): React.ReactElement {
  const [tool, setTool] = React.useState<ImageEditorTool>(initialTool)
  const [drawColor, setDrawColor] = React.useState<string>(DRAW_COLORS[0])
  const [brushSize, setBrushSize] = React.useState(6)
  const [textSize, setTextSize] = React.useState(36)
  const [eraserSize, setEraserSize] = React.useState(32)
  const [rotation, setRotation] = React.useState(0)
  const [annotations, setAnnotations] = React.useState<ImageAnnotation[]>([])
  const [draftAnnotation, setDraftAnnotation] = React.useState<ImageAnnotation | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [cropRect, setCropRect] = React.useState<ImageRect | null>(null)
  const [resizeRatio, setResizeRatio] = React.useState<ImageAspectRatio | null>(null)
  const [resizeWidth, setResizeWidth] = React.useState('')
  const [resizeHeight, setResizeHeight] = React.useState('')
  const [lockAspectRatio, setLockAspectRatio] = React.useState(true)
  const [backgroundTolerance, setBackgroundTolerance] = React.useState(40)
  const [textDraft, setTextDraft] = React.useState<TextDraft | null>(null)
  const [status, setStatus] = React.useState('')
  const [imageLoaded, setImageLoaded] = React.useState(false)
  const [imageError, setImageError] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [drawVersion, setDrawVersion] = React.useState(0)
  const [historyVersion, setHistoryVersion] = React.useState(0)
  const [inlineCanvasSize, setInlineCanvasSize] = React.useState({ w: 0, h: 0 })

  const displayCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const canvasStageRef = React.useRef<HTMLDivElement>(null)
  const baseCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const sourceImageRef = React.useRef<HTMLImageElement | null>(null)
  const annotationsRef = React.useRef<ImageAnnotation[]>([])
  const draftAnnotationRef = React.useRef<ImageAnnotation | null>(null)
  const cropRectRef = React.useRef<ImageRect | null>(null)
  const cropStartRef = React.useRef<ImagePoint | null>(null)
  const operationRef = React.useRef<Operation>(null)
  const moveRef = React.useRef<MoveState | null>(null)
  const lastPointRef = React.useRef<ImagePoint | null>(null)
  const checkerPatternRef = React.useRef<CanvasPattern | null>(null)
  const scaleRef = React.useRef(1)
  const displayDimRef = React.useRef({ w: 1, h: 1 })
  const rotationRef = React.useRef(0)
  const pastRef = React.useRef<EditorSnapshot[]>([])
  const futureRef = React.useRef<EditorSnapshot[]>([])
  const pendingHistoryRef = React.useRef<EditorSnapshot | null>(null)
  const restoreVersionRef = React.useRef(0)

  const updateAnnotations = React.useCallback((next: ImageAnnotation[]): void => {
    annotationsRef.current = next
    setAnnotations(next)
  }, [])

  const updateRotation = React.useCallback((next: number): void => {
    rotationRef.current = next
    setRotation(next)
  }, [])

  const updateDraftAnnotation = React.useCallback((next: ImageAnnotation | null): void => {
    draftAnnotationRef.current = next
    setDraftAnnotation(next)
  }, [])

  const updateCropRect = React.useCallback((next: ImageRect | null): void => {
    cropRectRef.current = next
    setCropRect(next)
  }, [])

  const captureSnapshot = React.useCallback((): EditorSnapshot | null => {
    const base = baseCanvasRef.current
    if (!base) return null
    return {
      image: base.toDataURL('image/png'),
      annotations: cloneImageAnnotations(annotationsRef.current),
      rotation: rotationRef.current,
    }
  }, [])

  const beginChange = React.useCallback((): boolean => {
    const snapshot = captureSnapshot()
    if (!snapshot) return false
    pendingHistoryRef.current = snapshot
    return true
  }, [captureSnapshot])

  const cancelChange = React.useCallback((): void => {
    pendingHistoryRef.current = null
  }, [])

  const commitChange = React.useCallback((): void => {
    const pending = pendingHistoryRef.current
    if (!pending) return
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), pending]
    futureRef.current = []
    pendingHistoryRef.current = null
    setHistoryVersion((version) => version + 1)
  }, [])

  const refreshCanvas = React.useCallback((): void => {
    setDrawVersion((version) => version + 1)
  }, [])

  // 加载底图。新图片会获得独立历史，避免跨图撤销。
  React.useEffect(() => {
    let cancelled = false
    setImageLoaded(false)
    setImageError(false)
    setStatus('')
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      sourceImageRef.current = img
      let width = img.naturalWidth
      let height = img.naturalHeight
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const base = document.createElement('canvas')
      base.width = width
      base.height = height
      const ctx = base.getContext('2d')
      if (!ctx) {
        setImageError(true)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      baseCanvasRef.current = base
      pastRef.current = []
      futureRef.current = []
      pendingHistoryRef.current = null
      updateAnnotations([])
      updateRotation(0)
      updateCropRect(null)
      setSelectedId(null)
      updateDraftAnnotation(null)
      setTextDraft(null)
      setTool(initialTool)
      setResizeRatio(null)
      setResizeWidth(String(width))
      setResizeHeight(String(height))
      setHistoryVersion((version) => version + 1)
      setImageLoaded(true)
      refreshCanvas()
    }
    img.onerror = () => {
      if (!cancelled) setImageError(true)
    }
    img.src = src
    return () => { cancelled = true }
  }, [src, initialTool, refreshCanvas, updateAnnotations, updateDraftAnnotation, updateCropRect, updateRotation])

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      checkerPatternRef.current = null
      refreshCanvas()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const handleResize = (): void => refreshCanvas()
    window.addEventListener('resize', handleResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [refreshCanvas])

  // 内联编辑器不能按整个窗口计算画布，否则窄侧边栏会溢出并拦截指针。
  React.useEffect(() => {
    if (layout !== 'inline') return
    const stage = canvasStageRef.current
    if (!stage) return
    const updateSize = (): void => {
      const next = { w: Math.floor(stage.clientWidth), h: Math.floor(stage.clientHeight) }
      setInlineCanvasSize((current) => current.w === next.w && current.h === next.h ? current : next)
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [layout])

  // 将底图、对象标注和选区绘制到统一显示坐标系。
  React.useEffect(() => {
    if (!imageLoaded) return
    const display = displayCanvasRef.current
    const base = baseCanvasRef.current
    if (!display || !base) return
    const maxW = layout === 'inline' ? inlineCanvasSize.w : document.documentElement.clientWidth * 0.9
    const maxH = layout === 'inline' ? inlineCanvasSize.h : document.documentElement.clientHeight * 0.72
    if (maxW < 1 || maxH < 1) return
    const rotated = rotation % 180 !== 0
    const sourceW = rotated ? base.height : base.width
    const sourceH = rotated ? base.width : base.height
    const scale = Math.min(maxW / sourceW, maxH / sourceH, 1)
    scaleRef.current = scale
    const displayW = Math.max(1, Math.floor(sourceW * scale))
    const displayH = Math.max(1, Math.floor(sourceH * scale))
    displayDimRef.current = { w: displayW, h: displayH }
    const dpr = window.devicePixelRatio || 1
    display.width = Math.floor(displayW * dpr)
    display.height = Math.floor(displayH * dpr)
    display.style.width = `${displayW}px`
    display.style.height = `${displayH}px`
    const ctx = display.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, displayW, displayH)

    if (!checkerPatternRef.current) {
      const patternCanvas = document.createElement('canvas')
      patternCanvas.width = 16
      patternCanvas.height = 16
      const patternContext = patternCanvas.getContext('2d')
      if (patternContext) {
        patternContext.fillStyle = readDesignColor('inset')
        patternContext.fillRect(0, 0, 8, 8)
        patternContext.fillRect(8, 8, 8, 8)
        patternContext.fillStyle = readDesignColor('panel')
        patternContext.fillRect(8, 0, 8, 8)
        patternContext.fillRect(0, 8, 8, 8)
        checkerPatternRef.current = ctx.createPattern(patternCanvas, 'repeat')
      }
    }
    if (checkerPatternRef.current) {
      ctx.fillStyle = checkerPatternRef.current
      ctx.fillRect(0, 0, displayW, displayH)
    }

    ctx.save()
    ctx.scale(scale, scale)
    if (rotation !== 0) {
      ctx.translate(sourceW / 2, sourceH / 2)
      ctx.rotate(rotation * Math.PI / 180)
      ctx.translate(-base.width / 2, -base.height / 2)
    }
    ctx.drawImage(base, 0, 0)
    for (const annotation of annotations) renderImageAnnotation(ctx, annotation)
    if (draftAnnotation) renderImageAnnotation(ctx, draftAnnotation)

    const selected = annotations.find((annotation) => annotation.id === selectedId)
    if (selected && tool === 'select') {
      const bounds = getAnnotationBounds(selected)
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2 / scale
      ctx.setLineDash([6 / scale, 4 / scale])
      ctx.strokeRect(bounds.x - 5, bounds.y - 5, bounds.w + 10, bounds.h + 10)
      ctx.setLineDash([])
    }

    if ((tool === 'crop' || tool === 'resize') && cropRect) {
      const rect = normalizedRect(cropRect)
      ctx.fillStyle = readDesignColor('overlay')
      ctx.globalAlpha = 0.45
      ctx.fillRect(0, 0, base.width, rect.y)
      ctx.fillRect(0, rect.y + rect.h, base.width, base.height - rect.y - rect.h)
      ctx.fillRect(0, rect.y, rect.x, rect.h)
      ctx.fillRect(rect.x + rect.w, rect.y, base.width - rect.x - rect.w, rect.h)
      ctx.globalAlpha = 1
      ctx.strokeStyle = readDesignColor('inverse-text')
      ctx.lineWidth = 2 / scale
      ctx.setLineDash([6 / scale, 3 / scale])
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      ctx.setLineDash([])
    }
    ctx.restore()
  }, [imageLoaded, rotation, annotations, draftAnnotation, selectedId, cropRect, tool, drawVersion, layout, inlineCanvasSize])

  const restoreSnapshot = React.useCallback((snapshot: EditorSnapshot): void => {
    const version = ++restoreVersionRef.current
    setRestoring(true)
    const image = new Image()
    image.onload = () => {
      if (version !== restoreVersionRef.current) return
      const base = document.createElement('canvas')
      base.width = image.naturalWidth
      base.height = image.naturalHeight
      const ctx = base.getContext('2d')
      if (ctx) {
        ctx.drawImage(image, 0, 0)
        baseCanvasRef.current = base
        updateAnnotations(cloneImageAnnotations(snapshot.annotations))
        updateRotation(snapshot.rotation)
        updateCropRect(null)
        updateDraftAnnotation(null)
        setSelectedId(null)
        setTextDraft(null)
        refreshCanvas()
      }
      setRestoring(false)
    }
    image.onerror = () => {
      if (version === restoreVersionRef.current) {
        setStatus('历史记录恢复失败')
        setRestoring(false)
      }
    }
    image.src = snapshot.image
  }, [refreshCanvas, updateAnnotations, updateDraftAnnotation, updateCropRect, updateRotation])

  const undo = React.useCallback((): void => {
    if (restoring) return
    const previous = pastRef.current.pop()
    if (!previous) return
    const current = captureSnapshot()
    if (!current) {
      pastRef.current.push(previous)
      return
    }
    futureRef.current.push(current)
    setHistoryVersion((version) => version + 1)
    restoreSnapshot(previous)
  }, [captureSnapshot, restoreSnapshot, restoring])

  const redo = React.useCallback((): void => {
    if (restoring) return
    const next = futureRef.current.pop()
    if (!next) return
    const current = captureSnapshot()
    if (!current) {
      futureRef.current.push(next)
      return
    }
    pastRef.current.push(current)
    setHistoryVersion((version) => version + 1)
    restoreSnapshot(next)
  }, [captureSnapshot, restoreSnapshot, restoring])

  const getCanvasPos = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): ImagePoint => {
    const canvas = displayCanvasRef.current
    const base = baseCanvasRef.current
    if (!canvas || !base) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const display = displayDimRef.current
    let x = (event.clientX - rect.left) * (display.w / rect.width) / scaleRef.current
    let y = (event.clientY - rect.top) * (display.h / rect.height) / scaleRef.current
    const currentRotation = rotationRef.current
    if (currentRotation !== 0) {
      const rotated = currentRotation % 180 !== 0
      const sourceW = rotated ? base.height : base.width
      const sourceH = rotated ? base.width : base.height
      x -= sourceW / 2
      y -= sourceH / 2
      const angle = -currentRotation * Math.PI / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const rotatedX = x * cos - y * sin
      const rotatedY = x * sin + y * cos
      x = rotatedX + base.width / 2
      y = rotatedY + base.height / 2
    }
    return { x: Math.max(0, Math.min(x, base.width)), y: Math.max(0, Math.min(y, base.height)) }
  }, [])

  const chooseTool = React.useCallback((next: ImageEditorTool): void => {
    setTool(next)
    updateCropRect(null)
    cropStartRef.current = null
    updateDraftAnnotation(null)
    setTextDraft(null)
    setStatus('')
    if (next === 'resize') {
      const base = baseCanvasRef.current
      if (base) {
        const rotated = rotationRef.current % 180 !== 0
        setResizeWidth(String(rotated ? base.height : base.width))
        setResizeHeight(String(rotated ? base.width : base.height))
      }
    } else {
      setResizeRatio(null)
    }
    if (next !== 'select') setSelectedId(null)
  }, [updateCropRect, updateDraftAnnotation])

  const changeColor = React.useCallback((color: string): void => {
    setDrawColor(color)
    if (!selectedId) return
    const selected = annotationsRef.current.find((annotation) => annotation.id === selectedId)
    if (!selected || !beginChange()) return
    updateAnnotations(annotationsRef.current.map((annotation) => annotation.id === selectedId ? { ...annotation, color } : annotation))
    commitChange()
    refreshCanvas()
  }, [selectedId, beginChange, updateAnnotations, commitChange, refreshCanvas])

  const changeAnnotationSize = React.useCallback((size: number): void => {
    const selected = annotationsRef.current.find((annotation) => annotation.id === selectedId)
    if (tool === 'text' || (tool === 'select' && selected?.type === 'text')) setTextSize(size)
    else setBrushSize(size)
    if (!selectedId) return
    if (!selected || !beginChange()) return
    updateAnnotations(annotationsRef.current.map((annotation) => annotation.id === selectedId ? { ...annotation, size } : annotation))
    commitChange()
    refreshCanvas()
  }, [tool, selectedId, beginChange, updateAnnotations, commitChange, refreshCanvas])

  const eraseAt = React.useCallback((from: ImagePoint, to: ImagePoint): void => {
    const base = baseCanvasRef.current
    const ctx = base?.getContext('2d')
    if (!base || !ctx) return
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = eraserSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.restore()
    const remaining = annotationsRef.current.filter((annotation) => !hitTestAnnotation(annotation, to, eraserSize / 2))
    if (remaining.length !== annotationsRef.current.length) updateAnnotations(remaining)
    refreshCanvas()
  }, [eraserSize, refreshCanvas, updateAnnotations])

  const applyBackgroundRemoval = React.useCallback((point?: ImagePoint): void => {
    const base = baseCanvasRef.current
    const ctx = base?.getContext('2d')
    if (!base || !ctx || !beginChange()) return
    const image = ctx.getImageData(0, 0, base.width, base.height)
    const result = point
      ? removeBackgroundAt(image, point, backgroundTolerance)
      : removeEdgeBackground(image, backgroundTolerance)
    if (result.removed === 0) {
      cancelChange()
      setStatus('未检测到相近色背景，可点击图片指定背景颜色')
      return
    }
    ctx.putImageData(new ImageData(result.data, base.width, base.height), 0, 0)
    commitChange()
    setStatus(`已移除 ${result.removed.toLocaleString()} 个背景像素`)
    refreshCanvas()
  }, [backgroundTolerance, beginChange, cancelChange, commitChange, refreshCanvas])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 || !event.isPrimary || restoring || operationRef.current) return
    const point = getCanvasPos(event)
    event.currentTarget.focus()
    if (tool === 'background') {
      applyBackgroundRemoval(point)
      return
    }
    if (tool === 'text') {
      setTextDraft({ x: point.x, y: point.y, value: '' })
      return
    }
    if (tool === 'crop' || tool === 'resize') {
      operationRef.current = 'crop'
      cropStartRef.current = point
      updateCropRect({ x: point.x, y: point.y, w: 0, h: 0 })
    } else if (tool === 'erase') {
      if (!beginChange()) return
      operationRef.current = 'erase'
      lastPointRef.current = point
      eraseAt(point, point)
    } else if (tool === 'select') {
      const selected = [...annotationsRef.current].reverse().find((annotation) => hitTestAnnotation(annotation, point))
      setSelectedId(selected?.id ?? null)
      if (!selected) return
      if (!beginChange()) return
      operationRef.current = 'move'
      moveRef.current = { id: selected.id, start: point, original: selected, moved: false }
    } else {
      if (!beginChange()) return
      operationRef.current = 'annotation'
      const base = { id: crypto.randomUUID(), color: drawColor, size: brushSize }
      const annotation: ImageAnnotation = tool === 'draw'
        ? { ...base, type: 'draw', points: [point] }
        : { ...base, type: tool, x: point.x, y: point.y, w: 0, h: 0 }
      updateDraftAnnotation(annotation)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [getCanvasPos, restoring, tool, applyBackgroundRemoval, updateCropRect, updateDraftAnnotation, beginChange, eraseAt, drawColor, brushSize])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const operation = operationRef.current
    if (!operation) return
    const point = getCanvasPos(event)
    if (operation === 'crop') {
      const start = cropStartRef.current
      if (!start) return
      let width = point.x - start.x
      let height = point.y - start.y
      if (tool === 'resize' && resizeRatio) {
        const ratioOption = IMAGE_ASPECT_RATIOS.find((option) => option.id === resizeRatio)
        if (ratioOption) {
          const ratio = rotationRef.current % 180 === 0 ? ratioOption.ratio : 1 / ratioOption.ratio
          if (Math.abs(width) / Math.max(1, Math.abs(height)) > ratio) width = Math.sign(width || 1) * Math.abs(height) * ratio
          else height = Math.sign(height || 1) * Math.abs(width) / ratio
        }
      }
      updateCropRect({ x: start.x, y: start.y, w: width, h: height })
    } else if (operation === 'annotation') {
      const current = draftAnnotationRef.current
      if (!current) return
      if (current.type === 'draw') updateDraftAnnotation({ ...current, points: [...current.points, point] })
      else if (current.type !== 'text') updateDraftAnnotation({ ...current, w: point.x - current.x, h: point.y - current.y })
    } else if (operation === 'erase') {
      eraseAt(lastPointRef.current ?? point, point)
      lastPointRef.current = point
    } else if (operation === 'move') {
      const move = moveRef.current
      if (!move) return
      const dx = point.x - move.start.x
      const dy = point.y - move.start.y
      if (dx !== 0 || dy !== 0) move.moved = true
      updateAnnotations(annotationsRef.current.map((annotation) => annotation.id === move.id ? translateAnnotation(move.original, dx, dy) : annotation))
    }
  }, [getCanvasPos, tool, resizeRatio, updateCropRect, updateDraftAnnotation, eraseAt, updateAnnotations])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const operation = operationRef.current
    if (!operation) return
    if (operation === 'annotation') {
      const draft = draftAnnotationRef.current
      if (draft && (draft.type === 'draw' || (draft.type !== 'text' && (Math.abs(draft.w) > 2 || Math.abs(draft.h) > 2)))) {
        updateAnnotations([...annotationsRef.current, draft])
        setSelectedId(draft.id)
        commitChange()
      } else cancelChange()
      updateDraftAnnotation(null)
    } else if (operation === 'erase') {
      commitChange()
      lastPointRef.current = null
    } else if (operation === 'move') {
      const move = moveRef.current
      if (move?.moved) commitChange()
      else cancelChange()
      moveRef.current = null
    }
    operationRef.current = null
    cropStartRef.current = null
    lastPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    refreshCanvas()
  }, [updateDraftAnnotation, updateAnnotations, commitChange, cancelChange, refreshCanvas])

  const cancelPointerOperation = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const operation = operationRef.current
    if (!operation) return
    if (operation === 'annotation') updateDraftAnnotation(null)
    if (operation === 'move' && moveRef.current) {
      const move = moveRef.current
      updateAnnotations(annotationsRef.current.map((annotation) => annotation.id === move.id ? move.original : annotation))
    }
    const pending = pendingHistoryRef.current
    operationRef.current = null
    cropStartRef.current = null
    moveRef.current = null
    lastPointRef.current = null
    cancelChange()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (operation === 'erase' && pending) restoreSnapshot(pending)
    else refreshCanvas()
  }, [cancelChange, refreshCanvas, restoreSnapshot, updateAnnotations, updateDraftAnnotation])

  const commitText = React.useCallback((): void => {
    if (!textDraft || !textDraft.value.trim()) {
      setTextDraft(null)
      return
    }
    if (!beginChange()) return
    const annotation: ImageAnnotation = {
      id: textDraft.id ?? crypto.randomUUID(),
      type: 'text',
      x: textDraft.x,
      y: textDraft.y,
      text: textDraft.value.trim(),
      color: drawColor,
      size: textSize,
    }
    updateAnnotations([...annotationsRef.current.filter((item) => item.id !== annotation.id), annotation])
    setSelectedId(annotation.id)
    setTextDraft(null)
    commitChange()
    refreshCanvas()
  }, [textDraft, beginChange, drawColor, textSize, updateAnnotations, commitChange, refreshCanvas])

  const deleteSelected = React.useCallback((): void => {
    if (!selectedId || !annotationsRef.current.some((annotation) => annotation.id === selectedId) || !beginChange()) return
    updateAnnotations(annotationsRef.current.filter((annotation) => annotation.id !== selectedId))
    setSelectedId(null)
    commitChange()
    refreshCanvas()
  }, [selectedId, beginChange, updateAnnotations, commitChange, refreshCanvas])

  const nudgeSelected = React.useCallback((dx: number, dy: number): void => {
    if (!selectedId || !beginChange()) return
    updateAnnotations(annotationsRef.current.map((annotation) => annotation.id === selectedId ? translateAnnotation(annotation, dx, dy) : annotation))
    commitChange()
    refreshCanvas()
  }, [selectedId, beginChange, updateAnnotations, commitChange, refreshCanvas])

  const applyCrop = React.useCallback((): boolean => {
    const pending = cropRectRef.current
    const base = baseCanvasRef.current
    if (!pending || !base) return false
    const rect = normalizedRect(pending)
    const x = Math.max(0, Math.round(rect.x))
    const y = Math.max(0, Math.round(rect.y))
    const w = Math.min(base.width - x, Math.round(rect.w))
    const h = Math.min(base.height - y, Math.round(rect.h))
    if (w < 4 || h < 4 || !beginChange()) return false
    const nextBase = document.createElement('canvas')
    nextBase.width = w
    nextBase.height = h
    const ctx = nextBase.getContext('2d')
    if (!ctx) {
      cancelChange()
      return false
    }
    ctx.drawImage(base, x, y, w, h, 0, 0, w, h)
    ctx.save()
    ctx.translate(-x, -y)
    for (const annotation of annotationsRef.current) renderImageAnnotation(ctx, annotation)
    ctx.restore()
    baseCanvasRef.current = nextBase
    updateAnnotations([])
    updateCropRect(null)
    setSelectedId(null)
    setResizeRatio(null)
    setTool('select')
    commitChange()
    refreshCanvas()
    return true
  }, [beginChange, cancelChange, commitChange, refreshCanvas, updateAnnotations, updateCropRect])

  const applyResize = React.useCallback((): boolean => {
    const base = baseCanvasRef.current
    const width = Number(resizeWidth)
    const height = Number(resizeHeight)
    if (!base || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_RESIZE_DIM || height > MAX_RESIZE_DIM || width * height > MAX_RESIZE_PIXELS) {
      setStatus(`尺寸须为 1–${MAX_RESIZE_DIM} 的整数，且总像素不超过 ${MAX_RESIZE_PIXELS / 1_000_000} 百万`)
      return false
    }
    if (!beginChange()) return false
    const currentRotation = rotationRef.current
    const rotated = currentRotation % 180 !== 0
    const source = document.createElement('canvas')
    source.width = rotated ? base.height : base.width
    source.height = rotated ? base.width : base.height
    const sourceCtx = source.getContext('2d')
    const nextBase = document.createElement('canvas')
    nextBase.width = width
    nextBase.height = height
    const ctx = nextBase.getContext('2d')
    if (!sourceCtx || !ctx) {
      cancelChange()
      return false
    }
    if (currentRotation !== 0) {
      sourceCtx.translate(source.width / 2, source.height / 2)
      sourceCtx.rotate(currentRotation * Math.PI / 180)
      sourceCtx.translate(-base.width / 2, -base.height / 2)
    }
    sourceCtx.drawImage(base, 0, 0)
    for (const annotation of annotationsRef.current) renderImageAnnotation(sourceCtx, annotation)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, width, height)
    baseCanvasRef.current = nextBase
    updateAnnotations([])
    updateRotation(0)
    updateCropRect(null)
    setSelectedId(null)
    setResizeRatio(null)
    setResizeWidth(String(width))
    setResizeHeight(String(height))
    setStatus(`已调整为 ${width} × ${height}`)
    commitChange()
    refreshCanvas()
    return true
  }, [resizeWidth, resizeHeight, beginChange, cancelChange, updateAnnotations, updateRotation, updateCropRect, commitChange, refreshCanvas])

  const updateResizeWidth = React.useCallback((value: string): void => {
    setResizeWidth(value)
    const base = baseCanvasRef.current
    const width = Number(value)
    if (!lockAspectRatio || !base || !(width > 0)) return
    const currentWidth = rotationRef.current % 180 !== 0 ? base.height : base.width
    const currentHeight = rotationRef.current % 180 !== 0 ? base.width : base.height
    setResizeHeight(String(Math.max(1, Math.round(width * currentHeight / currentWidth))))
  }, [lockAspectRatio])

  const updateResizeHeight = React.useCallback((value: string): void => {
    setResizeHeight(value)
    const base = baseCanvasRef.current
    const height = Number(value)
    if (!lockAspectRatio || !base || !(height > 0)) return
    const currentWidth = rotationRef.current % 180 !== 0 ? base.height : base.width
    const currentHeight = rotationRef.current % 180 !== 0 ? base.width : base.height
    setResizeWidth(String(Math.max(1, Math.round(height * currentWidth / currentHeight))))
  }, [lockAspectRatio])

  const selectAspectRatio = React.useCallback((id: ImageAspectRatio): void => {
    const base = baseCanvasRef.current
    const option = IMAGE_ASPECT_RATIOS.find((item) => item.id === id)
    if (!base || !option) return
    setResizeRatio(id)
    setTool('resize')
    updateCropRect(calculateCenteredAspectCrop(base.width, base.height, option.ratio, rotationRef.current))
  }, [updateCropRect])

  const handleRotate = React.useCallback((): void => {
    if (!beginChange()) return
    updateRotation((rotationRef.current + 90) % 360)
    updateCropRect(null)
    setSelectedId(null)
    commitChange()
    refreshCanvas()
  }, [beginChange, updateRotation, updateCropRect, commitChange, refreshCanvas])

  const handleReset = React.useCallback((): void => {
    const image = sourceImageRef.current
    if (!image || !beginChange()) return
    let width = image.naturalWidth
    let height = image.naturalHeight
    if (width > MAX_DIM || height > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
    }
    const base = document.createElement('canvas')
    base.width = width
    base.height = height
    const ctx = base.getContext('2d')
    if (!ctx) {
      cancelChange()
      return
    }
    ctx.drawImage(image, 0, 0, width, height)
    baseCanvasRef.current = base
    updateAnnotations([])
    updateRotation(0)
    updateCropRect(null)
    setSelectedId(null)
    setResizeRatio(null)
    setStatus('')
    commitChange()
    refreshCanvas()
  }, [beginChange, cancelChange, updateAnnotations, updateRotation, updateCropRect, commitChange, refreshCanvas])

  const handleExport = React.useCallback(async (): Promise<void> => {
    if (saving) return
    if ((tool === 'crop' || tool === 'resize') && cropRectRef.current) applyCrop()
    const base = baseCanvasRef.current
    if (!base) return
    const currentRotation = rotationRef.current
    const rotated = currentRotation % 180 !== 0
    const width = rotated ? base.height : base.width
    const height = rotated ? base.width : base.height
    const final = document.createElement('canvas')
    final.width = width
    final.height = height
    const ctx = final.getContext('2d')
    if (!ctx) return
    if (outputMimeType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    if (currentRotation !== 0) {
      ctx.translate(width / 2, height / 2)
      ctx.rotate(currentRotation * Math.PI / 180)
      ctx.translate(-base.width / 2, -base.height / 2)
    }
    ctx.drawImage(base, 0, 0)
    for (const annotation of annotationsRef.current) renderImageAnnotation(ctx, annotation)
    setSaving(true)
    setStatus('')
    try {
      await onSave(final.toDataURL(outputMimeType, 0.92))
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }, [tool, applyCrop, onSave, outputMimeType, saving])

  React.useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable)) return
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      } else if (command && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleExport()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        deleteSelected()
      } else if (selectedId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        nudgeSelected(
          event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0,
          event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0,
        )
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, handleExport, selectedId, deleteSelected, nudgeSelected])

  const isShape = tool === 'rect' || tool === 'ellipse' || tool === 'arrow'
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedId)
  const canUndo = pastRef.current.length > 0
  const canRedo = futureRef.current.length > 0
  void historyVersion

  if (!src) {
    return <div className="flex flex-col items-center gap-3 text-inverse-foreground/70"><span className="text-sm">无图片数据</span><button type="button" onClick={onCancel} className="rounded-full bg-card/10 px-4 py-1.5 text-sm hover:bg-card/20">返回</button></div>
  }

  return (
    <div className={cn(
      'flex w-full flex-col items-center gap-3',
      layout === 'lightbox' ? 'max-w-[96vw]' : 'h-full min-h-0 max-w-full overflow-y-auto p-4 pt-2',
    )}>
      <div ref={canvasStageRef} className={cn(
        'relative flex items-center justify-center',
        layout === 'inline' && 'min-h-[160px] w-full min-w-0 flex-1 overflow-hidden',
      )}>
        {imageError && (
          <div className="flex flex-col items-center gap-3 text-inverse-foreground/70" role="alert">
            <span className="text-sm">图片加载失败</span>
            <button type="button" onClick={onCancel} className="rounded-full bg-card/10 px-4 py-1.5 text-sm hover:bg-card/20">返回</button>
          </div>
        )}
        {!imageError && !imageLoaded && <div className="h-[150px] w-[200px]" role="status" aria-label="正在加载图片" />}
        <canvas
          ref={displayCanvasRef}
          tabIndex={0}
          aria-label="图片编辑画布"
          className={cn(
            'select-none rounded-lg shadow-2xl touch-none focus:outline-none',
            ['crop', 'resize', 'draw', 'rect', 'ellipse', 'arrow', 'erase', 'background', 'text'].includes(tool) && 'cursor-crosshair',
            tool === 'select' && 'cursor-default',
            (!imageLoaded || imageError) && 'hidden',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelPointerOperation}
          onDoubleClick={() => {
            if (tool === 'select' && selectedAnnotation?.type === 'text') {
              setTextDraft({ id: selectedAnnotation.id, x: selectedAnnotation.x, y: selectedAnnotation.y, value: selectedAnnotation.text })
            }
          }}
        />
      </div>

      {textDraft && (
        <div className="flex w-full max-w-[560px] items-end gap-2 rounded-2xl bg-overlay/60 p-2 shadow-lg backdrop-blur-md">
          <textarea
            autoFocus
            aria-label="标注文字"
            value={textDraft.value}
            onChange={(event) => setTextDraft((current) => current ? { ...current, value: event.target.value } : null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                commitText()
              }
              if (event.key === 'Escape') setTextDraft(null)
            }}
            placeholder="输入标注文字"
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-xl border border-card/15 bg-card/10 px-3 py-2 text-sm text-inverse-foreground outline-none placeholder:text-inverse-foreground/40 focus:border-ring/50"
          />
          <button type="button" onClick={commitText} className="rounded-xl bg-card/15 px-4 py-2 text-sm text-inverse-foreground hover:bg-card/25">添加</button>
        </div>
      )}

      {tool === 'resize' && (
        <div className={cn('flex flex-col items-center gap-2 rounded-2xl bg-overlay/50 p-2 shadow-lg backdrop-blur-md', layout === 'lightbox' ? 'max-w-[94vw]' : 'max-w-full')}>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-inverse-foreground/70">
              <span>宽</span>
              <input aria-label="图片宽度（像素）" type="number" min="1" max={MAX_RESIZE_DIM} step="1" value={resizeWidth} onChange={(event) => updateResizeWidth(event.target.value)} className="w-24 rounded-lg border border-card/15 bg-card/10 px-2 py-1.5 text-inverse-foreground outline-none focus:border-ring/50" />
            </label>
            <button type="button" aria-label={lockAspectRatio ? '解除比例锁定' : '锁定宽高比例'} aria-pressed={lockAspectRatio} title={lockAspectRatio ? '解除比例锁定' : '锁定宽高比例'} onClick={() => setLockAspectRatio((current) => !current)} className={cn('rounded-full p-1.5 text-inverse-foreground/60 hover:bg-card/15', lockAspectRatio && 'bg-card/15 text-inverse-foreground')}>
              <Link2 className="size-4" />
            </button>
            <label className="flex items-center gap-1.5 text-xs text-inverse-foreground/70">
              <span>高</span>
              <input aria-label="图片高度（像素）" type="number" min="1" max={MAX_RESIZE_DIM} step="1" value={resizeHeight} onChange={(event) => updateResizeHeight(event.target.value)} className="w-24 rounded-lg border border-card/15 bg-card/10 px-2 py-1.5 text-inverse-foreground outline-none focus:border-ring/50" />
            </label>
            <button type="button" onClick={applyResize} className="rounded-xl bg-card/15 px-3 py-1.5 text-xs font-medium text-inverse-foreground hover:bg-card/25">应用尺寸</button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {IMAGE_ASPECT_RATIOS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectAspectRatio(option.id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-inverse-foreground/70 hover:bg-card/15 hover:text-inverse-foreground',
                  resizeRatio === option.id && 'bg-card/20 text-inverse-foreground',
                )}
              >
                <span>{option.label}</span><span className="tabular-nums text-inverse-foreground/45">{option.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tool === 'background' && (
        <div className={cn('flex flex-wrap items-center justify-center gap-3 rounded-full bg-overlay/50 px-4 py-2 text-xs text-inverse-foreground/75 shadow-lg backdrop-blur-md', layout === 'lightbox' ? 'max-w-[94vw]' : 'max-w-full')}>
          <label className="flex items-center gap-2">
            <span>颜色容差</span>
            <input aria-label="背景颜色容差" type="range" min="0" max="120" value={backgroundTolerance} onChange={(event) => setBackgroundTolerance(Number(event.target.value))} className="w-28 accent-current" />
            <span className="w-7 tabular-nums">{backgroundTolerance}</span>
          </label>
          <button type="button" onClick={() => applyBackgroundRemoval()} className="rounded-full bg-card/15 px-3 py-1.5 hover:bg-card/25">自动移除</button>
        </div>
      )}

      {tool === 'erase' && (
        <label className="flex items-center gap-2 rounded-full bg-overlay/50 px-4 py-2 text-xs text-inverse-foreground/75 shadow-lg backdrop-blur-md">
          <span>擦除大小</span>
          <input aria-label="擦除大小" type="range" min="4" max="160" value={eraserSize} onChange={(event) => setEraserSize(Number(event.target.value))} className="w-32 accent-current" />
          <span className="w-8 tabular-nums">{eraserSize}</span>
        </label>
      )}

      {status && <p role="status" className={cn('text-center text-xs text-inverse-foreground/65', layout === 'lightbox' ? 'max-w-[80vw]' : 'max-w-full')}>{status}</p>}

      <div className={cn('flex flex-wrap items-center justify-center gap-1 rounded-[26px] bg-overlay/50 px-3 py-2.5 shadow-lg backdrop-blur-md', layout === 'lightbox' ? 'max-w-[96vw]' : 'max-w-full')}>
        <EditorButton label="选择标注" active={tool === 'select'} onClick={() => chooseTool('select')}><MousePointer2 className="size-5" /></EditorButton>
        <EditorButton label="画笔" active={tool === 'draw'} onClick={() => chooseTool('draw')}><Pencil className="size-5" /></EditorButton>
        <EditorButton label="文字" active={tool === 'text'} onClick={() => chooseTool('text')}><Type className="size-5" /></EditorButton>
        <EditorButton label="矩形" active={tool === 'rect'} onClick={() => chooseTool('rect')}><Square className="size-5" /></EditorButton>
        {isShape && (
          <>
            <EditorButton label="椭圆" active={tool === 'ellipse'} onClick={() => chooseTool('ellipse')}><Circle className="size-5" /></EditorButton>
            <EditorButton label="箭头" active={tool === 'arrow'} onClick={() => chooseTool('arrow')}><ArrowUpRight className="size-5" /></EditorButton>
          </>
        )}

        <div className="mx-1 flex items-center gap-1" aria-label="标注颜色">
          {DRAW_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`标注颜色 ${color}`}
              title={`标注颜色 ${color}`}
              onClick={() => changeColor(color)}
              className={cn('size-5 rounded-full border-2 transition-transform', drawColor === color ? 'scale-110 border-border' : 'border-card/25')}
              style={{ backgroundColor: color }}
            />
          ))}
          <label className="relative size-5 cursor-pointer overflow-hidden rounded-full border border-card/25" title="自定义颜色" style={{ background: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #ef4444)' }}>
            <input aria-label="自定义标注颜色" type="color" value={drawColor} onChange={(event) => changeColor(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
        </div>

        {(tool === 'draw' || isShape || (tool === 'select' && selectedAnnotation && selectedAnnotation.type !== 'text')) && (
          <div className="flex items-center gap-0.5">
            {BRUSH_SIZES.map((size) => (
              <button key={size} type="button" title={`笔触 ${size}px`} aria-label={`笔触 ${size}px`} onClick={() => changeAnnotationSize(size)} className={cn('flex size-7 items-center justify-center rounded-full text-inverse-foreground/70 hover:bg-card/15', brushSize === size && 'bg-card/20 text-inverse-foreground')}>
                <span className="rounded-full bg-current" style={{ width: Math.max(3, size * 0.7), height: Math.max(3, size * 0.7) }} />
              </button>
            ))}
          </div>
        )}
        {(tool === 'text' || (tool === 'select' && selectedAnnotation?.type === 'text')) && (
          <div className="flex items-center gap-0.5">
            {TEXT_SIZES.map((size) => <button key={size} type="button" onClick={() => changeAnnotationSize(size)} className={cn('rounded-full px-2 py-1 text-xs text-inverse-foreground/70 hover:bg-card/15', textSize === size && 'bg-card/20 text-inverse-foreground')}>{size}</button>)}
          </div>
        )}

        <EditorButton label="擦除" active={tool === 'erase'} onClick={() => chooseTool('erase')}><Eraser className="size-5" /></EditorButton>
        <EditorButton label="移除背景" active={tool === 'background'} onClick={() => chooseTool('background')}><ImageMinus className="size-5" /></EditorButton>
        <div className="mx-1 h-5 w-px bg-card/20" aria-hidden />
        <EditorButton label="裁剪" active={tool === 'crop'} onClick={() => chooseTool('crop')}><Crop className="size-5" /></EditorButton>
        <EditorButton label="旋转 90°" onClick={handleRotate}><RotateCw className="size-5" /></EditorButton>
        {(tool === 'crop' || tool === 'resize') && cropRect && Math.abs(cropRect.w) > 4 && Math.abs(cropRect.h) > 4 && (
          <EditorButton label={tool === 'resize' ? '应用比例' : '应用裁剪'} onClick={applyCrop} className="text-success"><Check className="size-5" /></EditorButton>
        )}
        <EditorButton label="撤销" disabled={!canUndo || restoring} onClick={undo}><Undo2 className="size-5" /></EditorButton>
        <EditorButton label="重做" disabled={!canRedo || restoring} onClick={redo}><Redo2 className="size-5" /></EditorButton>
        <EditorButton label="重置图片" onClick={handleReset}><RotateCw className="size-5 -scale-x-100" /></EditorButton>
        {selectedId && <EditorButton label="删除所选标注" onClick={deleteSelected}><X className="size-5" /></EditorButton>}
        <EditorButton label="取消编辑" disabled={saving} onClick={onCancel}><X className="size-5" /></EditorButton>
        <button
          type="button"
          onClick={handleExport}
          disabled={!imageLoaded || restoring || saving}
          className="rounded-full bg-card/15 px-4 py-2 text-sm font-medium text-inverse-foreground transition-colors hover:bg-card/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      <span className="sr-only">选择标注后可使用方向键微调，Delete 删除；Command 或 Control 加 Z 撤销。</span>
    </div>
  )
}
