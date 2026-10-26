import * as React from 'react'
import { attachScrollFade } from './scroll-fade'

interface SidebarScrollBoundaryProps {
  /** 唯一直接DOM子元素必须是列表的原生滚动容器。 */
  children: React.ReactNode
}

/** 滚动只更新边界状态，24px mask不叠加旧顶部渐变或额外滚动层。 */
export function SidebarScrollBoundary({ children }: SidebarScrollBoundaryProps): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const attachedRef = React.useRef<Element | null>(null)
  const cleanupRef = React.useRef<(() => void) | null>(null)
  const scrolledRef = React.useRef(false)
  const [isScrolled, setIsScrolled] = React.useState(false)

  const syncScrollState = React.useCallback((): void => {
    const scrollContainer = rootRef.current?.firstElementChild
    if (!scrollContainer) return
    const nextIsScrolled = scrollContainer.scrollTop > 1
    if (scrolledRef.current === nextIsScrolled) return
    scrolledRef.current = nextIsScrolled
    setIsScrolled(nextIsScrolled)
  }, [])

  React.useLayoutEffect(() => {
    const element = rootRef.current?.firstElementChild ?? null
    if (element !== attachedRef.current) {
      cleanupRef.current?.()
      attachedRef.current = element
      cleanupRef.current = element instanceof HTMLElement ? attachScrollFade(element, { fadeSize: 24 }) : null
    }
    syncScrollState()
  })
  React.useLayoutEffect(() => () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    attachedRef.current = null
  }, [])

  const handleScrollCapture = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    // 忽略会话行内预览等嵌套滚动。
    if (event.target === rootRef.current?.firstElementChild) syncScrollState()
  }, [syncScrollState])

  return (
    <div
      ref={rootRef}
      data-sidebar-scroll-boundary={isScrolled ? 'scrolled' : 'top'}
      className="relative flex min-h-0 flex-1 flex-col"
      onScrollCapture={handleScrollCapture}
    >
      {children}
    </div>
  )
}
