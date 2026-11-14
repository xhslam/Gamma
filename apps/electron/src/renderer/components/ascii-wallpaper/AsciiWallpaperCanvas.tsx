import * as React from 'react'
import { useAtomValue } from 'jotai'
import { chatWallpaperAtom } from '@/atoms/theme'
import type { ThemeStyle } from '../../../types'
import { CircleRevealTransition, type CircleRevealState } from './CircleRevealTransition'
import { createAsciiWallpaperEngine } from './engines'
import './ascii-wallpaper.css'

const FRAME_INTERVAL = 1000 / 30

export function AsciiWallpaperCanvas({ style, still = false }: {
  style: Exclude<ThemeStyle, 'default'>
  still?: boolean
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const engine = createAsciiWallpaperEngine(style)
    let visible = false
    let frame = 0
    let time = 0
    let lastPaint = 0
    let width = 0
    let height = 0
    let cssWidth = 0
    let cssHeight = 0

    const tick = (now: number): void => {
      const elapsed = now - lastPaint
      if (elapsed >= FRAME_INTERVAL - 1) {
        lastPaint = now
        time += Math.min(elapsed, FRAME_INTERVAL * 2)
        engine.paint(time, still || motion.matches)
      }
      frame = requestAnimationFrame(tick)
    }

    const syncAnimation = (): void => {
      cancelAnimationFrame(frame)
      if (!still && !motion.matches && visible && !document.hidden && width > 0 && height > 0) {
        lastPaint = performance.now()
        frame = requestAnimationFrame(tick)
      }
    }

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      // 拖动分屏时保持真实画布边界，大窗口限制位图像素量。
      const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1600 / rect.width, 1000 / rect.height)
      const nextWidth = Math.round(rect.width * scale)
      const nextHeight = Math.round(rect.height * scale)
      if (nextWidth === width && nextHeight === height && rect.width === cssWidth && rect.height === cssHeight) return
      cssWidth = rect.width
      cssHeight = rect.height
      width = nextWidth
      height = nextHeight
      canvas.width = width
      canvas.height = height
      if (width > 0 && height > 0) {
        ctx.setTransform(width / rect.width, 0, 0, height / rect.height, 0, 0)
        engine.init(ctx, rect.width, rect.height)
        engine.paint(time, still || motion.matches)
      }
      syncAnimation()
    }

    const sizes = new ResizeObserver(resize)
    const updateMotion = (): void => {
      if (width > 0 && height > 0 && (still || motion.matches)) engine.paint(time, true)
      syncAnimation()
    }
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      syncAnimation()
    })
    sizes.observe(canvas)
    intersection.observe(canvas)
    document.addEventListener('visibilitychange', syncAnimation)
    motion.addEventListener('change', updateMotion)
    resize()

    return () => {
      cancelAnimationFrame(frame)
      sizes.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', syncAnimation)
      motion.removeEventListener('change', updateMotion)
      engine.dispose()
    }
  }, [style, still])

  return <canvas ref={canvasRef} className="ascii-wallpaper-canvas" data-wallpaper-scene={style} aria-hidden="true" />
}

export function ChatWallpaper({ reveal, onRevealComplete }: {
  reveal: CircleRevealState | null
  onRevealComplete: () => void
}): React.ReactElement | null {
  const wallpaper = useAtomValue(chatWallpaperAtom)
  if (wallpaper === 'default') return null
  const transition = reveal?.style === wallpaper ? reveal : null
  return (
    <div
      className="ascii-wallpaper-container"
      aria-hidden="true"
    >
      <div className="ascii-wallpaper-art">
        {transition ? (
          <>
            {transition.previousStyle !== 'default' && <AsciiWallpaperCanvas style={transition.previousStyle} still />}
            <CircleRevealTransition point={transition.point} onComplete={onRevealComplete}>
              <AsciiWallpaperCanvas style={wallpaper} still />
            </CircleRevealTransition>
          </>
        ) : <AsciiWallpaperCanvas style={wallpaper} />}
      </div>
    </div>
  )
}
