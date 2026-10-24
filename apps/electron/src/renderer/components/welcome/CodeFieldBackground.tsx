import * as React from 'react'
import { createPortal } from 'react-dom'
import './code-field-background.css'

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CELL_WIDTH = 9
const CELL_HEIGHT = 16

const HOVER_LIFETIME = 450
const HOVER_RADIUS = 110

interface HoverPoint {
  x: number
  y: number
  at: number
}

interface CodeFieldBackgroundProps {
  /** 全尺寸会话面板，避免背景受消息栏限宽和输入区高度约束。 */
  container?: HTMLElement | null
}

/** 静态等色字符网格，仅鼠标移动附近短暂变色；空闲时不运行逐帧动画。 */
export function CodeFieldBackground({ container }: CodeFieldBackgroundProps = {}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const surface = canvas.parentElement
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let lastPaint = -Infinity
    let width = 0
    let height = 0
    let visible = true
    let ink = ''
    let glow = ''
    let baseOpacity = 0.15
    let glowOpacity = 0.64
    let lastHover: HoverPoint | null = null

    const paint = (now: number): void => {
      if (lastHover && now - lastHover.at >= HOVER_LIFETIME) lastHover = null
      context.clearRect(0, 0, width, height)
      context.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      context.textBaseline = 'top'
      for (let row = 0; row * CELL_HEIGHT < height; row++) {
        const y = row * CELL_HEIGHT
        for (let column = 0; column * CELL_WIDTH < width; column++) {
          const x = column * CELL_WIDTH
          const cell = column * 374761393 + row * 668265263
          const seed = Math.imul(cell ^ (cell >>> 13), 1274126177) >>> 0
          // 字符与底色始终固定，不随时间或鼠标事件重新随机化。
          const glyph = GLYPHS[seed % GLYPHS.length]!
          const distance = lastHover ? Math.hypot(x + CELL_WIDTH / 2 - lastHover.x, y + CELL_HEIGHT / 2 - lastHover.y) : HOVER_RADIUS
          const proximity = Math.max(0, 1 - distance / HOVER_RADIUS)
          const fade = lastHover ? Math.max(0, 1 - (now - lastHover.at) / HOVER_LIFETIME) : 0
          const highlight = proximity * proximity * fade
          context.fillStyle = ink
          context.globalAlpha = baseOpacity
          context.fillText(glyph, x, y)
          if (highlight > 0) {
            context.fillStyle = glow
            context.globalAlpha = highlight * glowOpacity
            context.fillText(glyph, x, y)
          }
        }
      }
      context.globalAlpha = 1
    }

    const stop = (): void => { cancelAnimationFrame(frame); frame = 0 }
    const animate = (now: number): void => {
      frame = 0
      if (now - lastPaint < 50) { frame = requestAnimationFrame(animate); return }
      paint(now)
      lastPaint = now
      if (lastHover && visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(animate)
    }
    const resume = (): void => {
      stop()
      if (motion.matches || document.hidden || !visible) { lastHover = null }
      if (!visible || document.hidden || width === 0 || height === 0) return
      paint(performance.now())
      if (lastHover && !motion.matches) frame = requestAnimationFrame(animate)
    }
    const getPointerPoint = (event: PointerEvent): HoverPoint | null => {
      if (!event.isPrimary || motion.matches || !visible || document.hidden) return null
      const target = event.target
      // 监听整个会话面板，画布继续穿透鼠标；交互控件不触发高亮。
      if (!(target instanceof Element) || target.closest('button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="textbox"], [role="slider"], [role="combobox"], [tabindex]')) return null
      const bounds = canvas.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      if (x < 0 || y < 0 || x >= width || y >= height) return null
      return { x, y, at: performance.now() }
    }
    const handlePointerMove = (event: PointerEvent): void => {
      if (event.buttons !== 0 || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return
      const point = getPointerPoint(event)
      if (!point) { lastHover = null; return }
      if (lastHover && point.x === lastHover.x && point.y === lastHover.y) return
      lastHover = point
      // 高频事件仅更新位置，每帧最多绘制一次；静止后渐隐并停止动画。
      if (!frame) frame = requestAnimationFrame(animate)
    }
    const handlePointerLeave = (): void => { lastHover = null }
    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const style = getComputedStyle(canvas)
      ink = style.getPropertyValue('--code-field-ink').trim()
      glow = style.getPropertyValue('--code-field-glow').trim()
      baseOpacity = Number(style.getPropertyValue('--code-field-base-opacity'))
      glowOpacity = Number(style.getPropertyValue('--code-field-glow-opacity'))
      resume()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      resume()
    })
    intersection.observe(canvas)
    const themeObserver = new MutationObserver(resize)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    motion.addEventListener('change', resume)
    document.addEventListener('visibilitychange', resume)
    surface?.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true })
    surface?.addEventListener('pointerleave', handlePointerLeave)
    resize()
    return () => {
      stop()
      observer.disconnect()
      intersection.disconnect()
      themeObserver.disconnect()
      motion.removeEventListener('change', resume)
      document.removeEventListener('visibilitychange', resume)
      surface?.removeEventListener('pointermove', handlePointerMove, true)
      surface?.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [container])

  const canvas = <canvas ref={canvasRef} className="code-field-background" style={container ? { zIndex: -1 } : undefined} aria-hidden="true" />
  return container ? createPortal(canvas, container) : canvas
}
