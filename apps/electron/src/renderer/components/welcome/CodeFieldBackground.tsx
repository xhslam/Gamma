import * as React from 'react'
import { createPortal } from 'react-dom'
import motionAtlasUrl from './code-field-motion.png'
import './code-field-background.css'

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CELL_WIDTH = 9
const CELL_HEIGHT = 16

// 逐源帧提取的 60 fps 光强遮罩。图集只包含蓝色光场的强度。
const MOTION_COLUMNS = 20
const MOTION_TILE_WIDTH = 48
const MOTION_TILE_HEIGHT = 40
const MOTION_FRAME_COUNT = 597
const MOTION_FPS = 60

interface CodeFieldBackgroundProps {
  /** 全尺寸会话面板，避免背景受消息栏限宽和输入区高度约束。 */
  container?: HTMLElement | null
}

/** 字符笔画固定，蓝色弧带沿参考视频的时间轴扫过。 */
export function CodeFieldBackground({ container }: CodeFieldBackgroundProps = {}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const base = document.createElement('canvas')
    const glyphs = document.createElement('canvas')
    const baseContext = base.getContext('2d')
    const glyphContext = glyphs.getContext('2d')
    if (!baseContext || !glyphContext) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const atlas = new Image()
    let visible = false
    let request = 0
    let startedAt: number | undefined
    let lastFrame = -1

    const drawBase = (): void => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(base, 0, 0)
    }

    const paint = (now: number): void => {
      startedAt ??= now
      const index = Math.floor((now - startedAt) * MOTION_FPS / 1000) % MOTION_FRAME_COUNT
      if (index !== lastFrame) {
        lastFrame = index
        const x = (index % MOTION_COLUMNS) * MOTION_TILE_WIDTH
        const y = Math.floor(index / MOTION_COLUMNS) * MOTION_TILE_HEIGHT
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(atlas, x, y, MOTION_TILE_WIDTH, MOTION_TILE_HEIGHT, 0, 0, canvas.width, canvas.height)
        context.globalCompositeOperation = 'source-in'
        context.drawImage(glyphs, 0, 0)
        context.globalCompositeOperation = 'destination-over'
        context.drawImage(base, 0, 0)
        context.globalCompositeOperation = 'source-over'
      }
      request = requestAnimationFrame(paint)
    }

    const sync = (): void => {
      cancelAnimationFrame(request)
      request = 0
      lastFrame = -1
      if (!canvas.width || !canvas.height) return
      if (!visible || document.hidden || motion.matches || !atlas.naturalWidth) {
        startedAt = undefined
        drawBase()
        return
      }
      request = requestAnimationFrame(paint)
    }

    const resize = (): void => {
      const { width, height } = canvas.getBoundingClientRect()
      // 高 DPI 下限制光场缓冲区，避免空白窗口的持续合成抢占会话渲染预算。
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      for (const layer of [canvas, base, glyphs]) {
        layer.width = Math.round(width * dpr)
        layer.height = Math.round(height * dpr)
      }
      const style = getComputedStyle(canvas)
      baseContext.setTransform(dpr, 0, 0, dpr, 0, 0)
      glyphContext.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const layer of [baseContext, glyphContext]) {
        layer.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        layer.textBaseline = 'top'
      }
      baseContext.fillStyle = style.getPropertyValue('--code-field-ink').trim()
      glyphContext.fillStyle = style.getPropertyValue('--code-field-glow').trim()
      glyphContext.globalAlpha = Number(style.getPropertyValue('--code-field-glow-opacity'))
      const baseOpacity = Number(style.getPropertyValue('--code-field-base-opacity'))

      for (let row = 0; row * CELL_HEIGHT < height; row++) {
        for (let column = 0; column * CELL_WIDTH < width; column++) {
          const x = column * CELL_WIDTH
          const y = row * CELL_HEIGHT
          const cell = column * 374761393 + row * 668265263
          const seed = Math.imul(cell ^ (cell >>> 13), 1274126177) >>> 0
          const glyph = GLYPHS[seed % GLYPHS.length]!
          // 低反差字符沿边缘与不规则暗带出现，中央给会话文字留出对比度。
          const field = 0.55 + 0.45 * Math.cos(x * 0.012 + Math.sin(y * 0.012) * 2) ** 2
          baseContext.globalAlpha = field * baseOpacity
          baseContext.fillText(glyph, x, y)
          glyphContext.fillText(glyph, x, y)
        }
      }
      sync()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      sync()
    })
    intersection.observe(canvas)
    const themeObserver = new MutationObserver(resize)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    atlas.addEventListener('load', sync)
    atlas.src = motionAtlasUrl
    motion.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    resize()
    return () => {
      cancelAnimationFrame(request)
      observer.disconnect()
      intersection.disconnect()
      themeObserver.disconnect()
      atlas.removeEventListener('load', sync)
      motion.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [container])

  const canvas = <canvas ref={canvasRef} className="code-field-background" style={container ? { zIndex: -1 } : undefined} aria-hidden="true" />
  return container ? createPortal(canvas, container) : canvas
}
