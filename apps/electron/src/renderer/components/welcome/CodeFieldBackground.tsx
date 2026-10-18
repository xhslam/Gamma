import * as React from 'react'
import { CODE_FIELD_MAX_RIPPLES, CODE_FIELD_RIPPLE_LIFETIME, sampleCodeFieldRipple } from './code-field-ripple'
import type { CodeFieldRipple } from './code-field-ripple'
import './code-field-background.css'

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CELL_WIDTH = 9
const CELL_HEIGHT = 16

/** 固定字符网格上的柔和流场：只改变亮度与少量字符，不做下落雨。 */
export function CodeFieldBackground(): React.ReactElement {
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
    let ripples: CodeFieldRipple[] = []
    const started = performance.now()

    const paint = (now: number): void => {
      const time = motion.matches ? 0 : (now - started) / 1000
      ripples = ripples.filter((ripple) => now - ripple.startedAt < CODE_FIELD_RIPPLE_LIFETIME)
      context.clearRect(0, 0, width, height)
      context.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      context.textBaseline = 'top'
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.28 + 0.8)
      for (let row = 0; row * CELL_HEIGHT < height; row++) {
        const y = row * CELL_HEIGHT
        const v = y / Math.max(height, 1)
        for (let column = 0; column * CELL_WIDTH < width; column++) {
          const x = column * CELL_WIDTH
          const u = x / Math.max(width, 1)
          const cell = column * 374761393 + row * 668265263
          const seed = Math.imul(cell ^ (cell >>> 13), 1274126177) >>> 0
          // 每格独立换字，避免整屏同步闪烁；所有内容均为本地生成的无意义字符。
          const tick = Math.floor(time * (0.7 + (seed % 7) * 0.11) + seed % 23)
          const scrambled = Math.imul(seed ^ (tick * 2246822519), 3266489917) >>> 0
          const glyph = GLYPHS[scrambled % GLYPHS.length]!
          const ribbon = Math.sin(u * 8 + Math.sin(v * 5 - time * 0.19) * 2.1 + time * 0.16)
          const wave = Math.exp(-ribbon * ribbon * 8)
          const cloud = 0.5 + 0.5 * Math.sin(v * 7 + u * 4 - time * 0.23)
          const variation = 0.35 + (seed % 19) / 29
          // 中央给问候语留出安静区域，边缘自然消失。
          const center = 1 - 0.82 * Math.exp(-((u - 0.5) ** 2 * 24 + (v - 0.48) ** 2 * 28))
          const edge = Math.min(1, (Math.min(u, 1 - u) + 0.025) * 12)
          const light = wave * cloud * variation * center * edge
          const ripple = sampleCodeFieldRipple(ripples, x + CELL_WIDTH / 2, y + CELL_HEIGHT / 2, now)
          // 波峰轻轻推动字符并提亮，形成水面感而非叠加一条实心圆线。
          const offset = ripple * 2 * Math.sin(time * 9 + row * 0.4)
          context.fillStyle = ink
          context.globalAlpha = (0.055 + light * 0.12) * (1 - pulse * 0.4)
          context.fillText(glyph, x, y + offset)
          context.fillStyle = glow
          context.globalAlpha = Math.min(0.8, light * pulse * 0.46 + ripple * 0.65)
          context.fillText(glyph, x, y + offset)
        }
      }
      context.globalAlpha = 1
    }

    const stop = (): void => { cancelAnimationFrame(frame); frame = 0 }
    const animate = (now: number): void => {
      frame = 0
      if (now - lastPaint >= 50) { paint(now); lastPaint = now }
      if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(animate)
    }
    const resume = (): void => {
      stop()
      if (motion.matches || document.hidden) ripples = []
      if (!visible || document.hidden || width === 0 || height === 0) return
      paint(performance.now())
      if (!motion.matches) frame = requestAnimationFrame(animate)
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !event.isPrimary || motion.matches || !visible || document.hidden) return
      const target = event.target
      // 监听背景的父容器，画布继续穿透鼠标；交互控件不触发涟漪。
      if (!(target instanceof Element) || target.closest('button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="textbox"], [role="slider"], [role="combobox"], [tabindex]')) return
      const bounds = canvas.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      if (x < 0 || y < 0 || x >= width || y >= height) return
      const now = performance.now()
      ripples = [...ripples.slice(-(CODE_FIELD_MAX_RIPPLES - 1)), { x, y, startedAt: now }]
      paint(now)
    }
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
    resize()
    return () => {
      stop()
      observer.disconnect()
      intersection.disconnect()
      themeObserver.disconnect()
      motion.removeEventListener('change', resume)
      document.removeEventListener('visibilitychange', resume)
      surface?.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [])

  return <canvas ref={canvasRef} className="code-field-background" aria-hidden="true" />
}
