import * as React from 'react'
import { createPortal } from 'react-dom'
import { useAtomValue } from 'jotai'
import { themeStyleAtom } from '@/atoms/theme'
import type { ThemeStyle } from '../../../types'
import { createAsciiWallpaperEngine } from './engines'
import type { AsciiWallpaperEngine } from './engine-types'
import './ascii-wallpaper.css'

interface AsciiWallpaperCanvasProps {
  container?: HTMLElement | null
  styleOverride?: ThemeStyle
  className?: string
}

export function AsciiWallpaperCanvas({
  container,
  styleOverride,
  className,
}: AsciiWallpaperCanvasProps = {}): React.ReactElement {
  const currentStyle = useAtomValue(themeStyleAtom)
  const activeStyle = styleOverride ?? currentStyle
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const engineRef = React.useRef<AsciiWallpaperEngine | null>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const engine = createAsciiWallpaperEngine(activeStyle)
    engineRef.current = engine

    let visible = true
    let animationFrame = 0

    const paintLoop = (now: number): void => {
      if (!visible || document.hidden) return
      engine.paint(now)
      if (!motion.matches) {
        animationFrame = requestAnimationFrame(paintLoop)
      }
    }

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      engine.resize(rect.width, rect.height)
      engine.init(ctx, rect.width, rect.height)
      engine.paint(performance.now())
    }

    const handleVisibilityChange = (): void => {
      cancelAnimationFrame(animationFrame)
      if (!document.hidden && visible && !motion.matches) {
        animationFrame = requestAnimationFrame(paintLoop)
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      resize()
      cancelAnimationFrame(animationFrame)
      if (visible && !document.hidden && !motion.matches) {
        animationFrame = requestAnimationFrame(paintLoop)
      }
    })
    resizeObserver.observe(canvas)

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      cancelAnimationFrame(animationFrame)
      if (visible && !document.hidden && !motion.matches) {
        animationFrame = requestAnimationFrame(paintLoop)
      }
    })
    intersectionObserver.observe(canvas)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    motion.addEventListener('change', handleVisibilityChange)

    resize()
    if (!motion.matches) {
      animationFrame = requestAnimationFrame(paintLoop)
    }

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      motion.removeEventListener('change', handleVisibilityChange)
      engine.dispose()
      engineRef.current = null
    }
  }, [activeStyle])

  const canvas = (
    <div className={`ascii-wallpaper-container ${className ?? ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="ascii-wallpaper-canvas" />
    </div>
  )

  return container ? createPortal(canvas, container) : canvas
}
