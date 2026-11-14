import * as React from 'react'
import type { ThemeStyle } from '../../../types'

export interface CircleRevealState {
  point: { x: number; y: number }
  style: ThemeStyle
  previousStyle: ThemeStyle
}

export function calculateCircleRevealRadius(
  origin: { x: number; y: number },
  viewport: { width: number; height: number },
): number {
  return Math.ceil(Math.hypot(
    Math.max(Math.abs(origin.x), Math.abs(viewport.width - origin.x)),
    Math.max(Math.abs(origin.y), Math.abs(viewport.height - origin.y)),
  ))
}

interface CircleRevealTransitionProps {
  point: CircleRevealState['point']
  onComplete: () => void
  children: React.ReactNode
}

export function CircleRevealTransition({ point, onComplete, children }: CircleRevealTransitionProps): React.ReactElement {
  const layer = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const element = layer.current
    if (!element) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onComplete()
      return
    }

    const rect = element.getBoundingClientRect()
    const origin = { x: point.x - rect.left, y: point.y - rect.top }
    const radius = calculateCircleRevealRadius(origin, rect)
    const animation = element.animate(
      [0, radius].map((size) => ({ clipPath: `circle(${size}px at ${origin.x}px ${origin.y}px)` })),
      { duration: 280, easing: 'cubic-bezier(.2,.7,.3,1)' },
    )
    animation.onfinish = onComplete
    return () => animation.cancel()
  }, [point, onComplete])

  return <div ref={layer} data-wallpaper-reveal="" className="absolute inset-0">{children}</div>
}
