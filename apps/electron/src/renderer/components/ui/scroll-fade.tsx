import * as React from 'react'
import { getScrollFadeComposite, getScrollFadeEdges, getScrollFadeMask } from '@/lib/scroll-fade-policy'
import type { ScrollFadeOrientation } from '@/lib/scroll-fade-policy'
import { cn } from '@/lib/utils'

interface ScrollFadeOptions {
  orientation?: ScrollFadeOrientation
  fadeSize?: number
}

/** 直接绑定实际滚动元素；不增加滚动层，也不遮盖同级工具栏和浮层。 */
export function attachScrollFade(element: HTMLElement, { orientation = 'vertical', fadeSize = 24 }: ScrollFadeOptions = {}): () => void {
  const properties = ['mask-image', '-webkit-mask-image', 'mask-composite', '-webkit-mask-composite', '--scroll-fade-top', '--scroll-fade-bottom', '--scroll-fade-left', '--scroll-fade-right']
  const previous = properties.map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)] as const)
  const previousAttribute = element.getAttribute('data-scroll-fade')
  let frame = 0
  const contrast = window.matchMedia('(forced-colors: active)')
  const refresh = (): void => {
    frame = 0
    const vertical = getScrollFadeEdges(element.scrollHeight, element.clientHeight, element.scrollTop, fadeSize)
    const maximumLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    const style = getComputedStyle(element)
    // Chromium的RTL scrollLeft从0向负值增长，转换成物理左侧偏移。
    const left = style.direction === 'rtl' ? maximumLeft + element.scrollLeft : element.scrollLeft
    const horizontal = getScrollFadeEdges(element.scrollWidth, element.clientWidth, left, fadeSize)
    element.style.setProperty('--scroll-fade-top', `${vertical.start}px`)
    element.style.setProperty('--scroll-fade-bottom', `${vertical.end}px`)
    element.style.setProperty('--scroll-fade-left', `${horizontal.start}px`)
    element.style.setProperty('--scroll-fade-right', `${horizontal.end}px`)

    // 键盘焦点进入渐隐带时保留完整轮廓，不改动滚动位置或聊天自动滚动策略。
    const focused = document.activeElement
    if (focused instanceof HTMLElement && element.contains(focused) && focused.matches(':focus-visible')) {
      const viewport = element.getBoundingClientRect()
      const rect = focused.getBoundingClientRect()
      if (rect.top < viewport.top + vertical.start) element.style.setProperty('--scroll-fade-top', '0px')
      if (rect.bottom > viewport.top + element.clientHeight - vertical.end) element.style.setProperty('--scroll-fade-bottom', '0px')
      if (rect.left < viewport.left + horizontal.start) element.style.setProperty('--scroll-fade-left', '0px')
      if (rect.right > viewport.left + element.clientWidth - horizontal.end) element.style.setProperty('--scroll-fade-right', '0px')
    }
    const verticalGutter = Math.max(0, element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth))
    const horizontalGutter = Math.max(0, element.offsetHeight - element.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth))
    const gutters = {
      vertical: verticalGutter,
      horizontal: horizontalGutter,
      verticalSide: element.clientLeft > parseFloat(style.borderLeftWidth) + 1 ? 'left' as const : 'right' as const,
    }
    const mask = contrast.matches ? 'none' : getScrollFadeMask(orientation, gutters)
    const composite = getScrollFadeComposite(orientation, gutters)
    element.style.maskImage = mask
    element.style.webkitMaskImage = mask
    element.style.setProperty('-webkit-mask-composite', composite.replaceAll('intersect', 'source-in').replaceAll('add', 'source-over'))
    element.style.setProperty('mask-composite', composite)
    element.dataset.scrollFade = orientation
  }
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(refresh) }
  const resize = new ResizeObserver(schedule)
  const observeChildren = (): void => {
    resize.disconnect()
    resize.observe(element)
    for (const child of element.children) resize.observe(child)
  }
  const mutation = new MutationObserver(() => { observeChildren(); schedule() })
  observeChildren()
  mutation.observe(element, { subtree: true, childList: true, characterData: true })
  element.addEventListener('scroll', schedule, { passive: true })
  element.addEventListener('focusin', schedule)
  element.addEventListener('focusout', schedule)
  contrast.addEventListener('change', schedule)
  refresh()
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    mutation.disconnect()
    element.removeEventListener('scroll', schedule)
    element.removeEventListener('focusin', schedule)
    element.removeEventListener('focusout', schedule)
    contrast.removeEventListener('change', schedule)
    for (const [name, value, priority] of previous) {
      if (value) element.style.setProperty(name, value, priority)
      else element.style.removeProperty(name)
    }
    if (previousAttribute === null) delete element.dataset.scrollFade
    else element.setAttribute('data-scroll-fade', previousAttribute)
  }
}

export interface ScrollFadeProps extends React.HTMLAttributes<HTMLDivElement>, ScrollFadeOptions {}

export function ScrollFade({ orientation = 'vertical', fadeSize = 24, className, ...props }: ScrollFadeProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current) return attachScrollFade(ref.current, { orientation, fadeSize })
  }, [orientation, fadeSize])
  return <div {...props} ref={ref} className={cn('min-h-0 min-w-0 overflow-auto', className)} />
}
