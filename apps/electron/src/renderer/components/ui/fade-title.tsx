import * as React from 'react'
import { cn } from '@/lib/utils'

// 全部标题共用观察器与一帧测量队列，不在列表行内各建一套Observer或React状态。
const titles = new Set<HTMLElement>()
const pending = new Set<HTMLElement>()
let resize: ResizeObserver | null = null
let theme: MutationObserver | null = null
let frame = 0

function flush(): void {
  frame = 0
  for (const element of pending) {
    if (!titles.has(element)) continue
    const next = element.clientWidth > 0 && element.scrollWidth > element.clientWidth ? 'true' : 'false'
    if (element.dataset.titleOverflow !== next) element.dataset.titleOverflow = next
  }
  pending.clear()
}

function schedule(element: HTMLElement): void {
  pending.add(element)
  if (!frame) frame = requestAnimationFrame(flush)
}

function scheduleAll(): void {
  for (const element of titles) schedule(element)
}

function observeTitle(element: HTMLElement): () => void {
  if (!resize) {
    resize = new ResizeObserver((entries) => {
      for (const entry of entries) if (entry.target instanceof HTMLElement) schedule(entry.target)
    })
    // 只观察主题根的class/style，不扫描整棵DOM；主题字重改变也可能影响溢出。
    theme = new MutationObserver(scheduleAll)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    document.fonts.addEventListener('loadingdone', scheduleAll)
    void document.fonts.ready.then(scheduleAll)
  }
  titles.add(element)
  resize.observe(element)
  schedule(element)
  return () => {
    titles.delete(element)
    pending.delete(element)
    resize?.unobserve(element)
    if (titles.size === 0) {
      resize?.disconnect()
      theme?.disconnect()
      resize = null
      theme = null
      cancelAnimationFrame(frame)
      frame = 0
      document.fonts.removeEventListener('loadingdone', scheduleAll)
    }
  }
}

export interface FadeTitleProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'h4'
}

/** 保留完整文本与语义；仅实际溢出的单行标题启用右侧24px渐隐。 */
export const FadeTitle = React.forwardRef<HTMLElement, FadeTitleProps>(function FadeTitle(
  { as: tag = 'span', className, children, ...props }, forwardedRef,
) {
  const ref = React.useRef<HTMLElement | null>(null)
  const setRef = React.useCallback((element: HTMLElement | null): void => {
    ref.current = element
    if (typeof forwardedRef === 'function') forwardedRef(element)
    else if (forwardedRef) forwardedRef.current = element
  }, [forwardedRef])
  React.useLayoutEffect(() => {
    if (ref.current) return observeTitle(ref.current)
  }, [tag])
  React.useLayoutEffect(() => {
    if (ref.current) schedule(ref.current)
  })
  return React.createElement(tag, { ...props, ref: setRef, className: cn('gamma-fade-title', className) }, children)
})
