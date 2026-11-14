import * as React from 'react'
import type { ThemeStyle } from '@/types'
import { AsciiWallpaperCanvas } from './AsciiWallpaperCanvas'

export function calculateCircleRevealRadius(
  origin: { x: number; y: number },
  viewport: { width: number; height: number }
): number {
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ]
  const maxDistance = Math.max(
    ...corners.map((c) => Math.hypot(c.x - origin.x, c.y - origin.y))
  )
  return Math.ceil(maxDistance * 1.05)
}

interface CircleRevealTransitionProps {
  targetStyle: ThemeStyle
  originX: number
  originY: number
  onComplete: () => void
  durationMs?: number
}

export function CircleRevealTransition({
  targetStyle,
  originX,
  originY,
  onComplete,
  durationMs = 380,
}: CircleRevealTransitionProps): React.ReactElement {
  const [currentRadius, setCurrentRadius] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motion.matches) {
      onComplete()
      return
    }

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const maxRadius = calculateCircleRevealRadius({ x: originX, y: originY }, viewport)

    let animationFrame = 0
    const startTime = performance.now()

    const animate = (now: number): void => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / durationMs)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrentRadius(eased * maxRadius)

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate)
      } else {
        onComplete()
      }
    }

    animationFrame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [originX, originY, durationMs, onComplete])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
      style={{
        clipPath: `circle(${currentRadius}px at ${originX}px ${originY}px)`,
        WebkitClipPath: `circle(${currentRadius}px at ${originX}px ${originY}px)`,
      }}
      aria-hidden="true"
    >
      <AsciiWallpaperCanvas styleOverride={targetStyle} />
    </div>
  )
}
