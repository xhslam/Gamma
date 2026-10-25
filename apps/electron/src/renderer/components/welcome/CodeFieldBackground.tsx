import * as React from 'react'
import { createPortal } from 'react-dom'
import { CODE_FIELD_MAX_RIPPLES, codeFieldRippleLifetime, sampleCodeFieldRipple } from './code-field-ripple'
import type { CodeFieldRipple } from './code-field-ripple'
import './code-field-background.css'

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CELL_WIDTH = 9
const CELL_HEIGHT = 16

const HOVER_INTERVAL = 65
const HOVER_DISTANCE = 12

interface HoverPoint {
  x: number
  y: number
  at: number
}

interface CodeFieldBackgroundProps {
  /** 全尺寸会话面板，避免背景受消息栏限宽和输入区高度约束。 */
  container?: HTMLElement | null
}

/** 静态等色字符网格；鼠标经过时产生柔和水光，沿轨迹扩散并渐隐。 */
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
    let ripples: CodeFieldRipple[] = []

    const paint = (now: number): void => {
      ripples = ripples.filter(ripple => now - ripple.startedAt < codeFieldRippleLifetime(ripple))
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
          const highlight = sampleCodeFieldRipple(ripples, x + CELL_WIDTH / 2, y + CELL_HEIGHT / 2, now)
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
      if (now - lastPaint < 1000 / 60) { frame = requestAnimationFrame(animate); return }
      paint(now)
      lastPaint = now
      if (ripples.length > 0 && visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(animate)
    }
    const resume = (): void => {
      stop()
      if (motion.matches || document.hidden || !visible) { lastHover = null; ripples = [] }
      if (!visible || document.hidden || width === 0 || height === 0) return
      paint(performance.now())
      if (ripples.length > 0 && !motion.matches) frame = requestAnimationFrame(animate)
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
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const point = getPointerPoint(event)
      if (!point) return
      // 点击用固定圆心的强涟漪，移动仅留较轻余波；不拦截上层点击行为。
      lastHover = point
      ripples = [...ripples.slice(-(CODE_FIELD_MAX_RIPPLES - 1)), { x: point.x, y: point.y, startedAt: point.at, strength: 1.6, kind: 'click' }]
      if (!frame) frame = requestAnimationFrame(animate)
    }
    const handlePointerMove = (event: PointerEvent): void => {
      if (event.buttons !== 0 || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return
      const point = getPointerPoint(event)
      if (!point) { lastHover = null; return }
      if (lastHover && (point.at - lastHover.at < HOVER_INTERVAL || Math.hypot(point.x - lastHover.x, point.y - lastHover.y) < HOVER_DISTANCE)) return
      lastHover = point
      // 保留移动轨迹，宽波峰相互交叠；离开后仍自然扩散，不突然截断。
      ripples = [...ripples.slice(-(CODE_FIELD_MAX_RIPPLES - 1)), { x: point.x, y: point.y, startedAt: point.at, strength: 0.32, kind: 'hover' }]
      // 高频事件不直接绘制；仅在涟漪存续期间运行逐帧动画。
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
    surface?.addEventListener('pointerdown', handlePointerDown, true)
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
      surface?.removeEventListener('pointerdown', handlePointerDown, true)
      surface?.removeEventListener('pointermove', handlePointerMove, true)
      surface?.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [container])

  const canvas = <canvas ref={canvasRef} className="code-field-background" style={container ? { zIndex: -1 } : undefined} aria-hidden="true" />
  return container ? createPortal(canvas, container) : canvas
}
