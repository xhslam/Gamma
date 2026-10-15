import type * as React from 'react'
import { isImeKeyboardEvent } from './ime-keyboard-policy'

/** 横幅只处理自身已聚焦的选项；Enter/Space 保留原生按钮行为，不监听全局授权键。 */
export function handleBannerNavigation(event: React.KeyboardEvent<HTMLDivElement>, composing: boolean): void {
  if (isImeKeyboardEvent(event.nativeEvent, composing)) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const target = event.target
  if (!(target instanceof HTMLButtonElement) || !target.hasAttribute('data-banner-option')) return
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-banner-option]:not(:disabled)'))
  const index = options.indexOf(target)
  if (index < 0 || options.length === 0) return
  event.preventDefault()
  const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  options[next]?.focus()
}
