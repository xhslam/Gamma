import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'
import type { ScrollToBottom, StickToBottomInstance, StickToBottomOptions } from 'use-stick-to-bottom'
import { canResumeConversationFollow, CONVERSATION_INPUT_COOLDOWN_MS, getConversationScrollDistance, isConversationScrollKey } from '@/lib/conversation-scroll-policy'

/** 仅扩展既有滚动实例的用户意图策略，不创建第二个自动定位器。 */
export function useConversationScrollPolicy(options: StickToBottomOptions): { instance: StickToBottomInstance; distance: number } {
  const paused = useRef(false)
  const lastInput = useRef(Number.NEGATIVE_INFINITY)
  const explicitJump = useRef(false)
  const [distance, setDistance] = useState(0)
  const requestedTarget = options.targetScrollTop
  const targetScrollTop = useCallback<NonNullable<StickToBottomOptions['targetScrollTop']>>((target, elements) => {
    if (paused.current && !explicitJump.current) return elements.scrollElement.scrollTop
    return requestedTarget?.(target, elements) ?? target
  }, [requestedTarget])
  const original = useStickToBottom({ ...options, targetScrollTop })
  const { scrollRef, contentRef, stopScroll: originalStop, scrollToBottom: originalScroll } = original
  const stopScroll = useCallback((): void => {
    paused.current = true
    explicitJump.current = false
    originalStop()
  }, [originalStop])
  const scrollToBottom = useCallback<ScrollToBottom>((scrollOptions) => {
    paused.current = false
    explicitJump.current = true
    const result = originalScroll(scrollOptions)
    void Promise.resolve(result).finally(() => { explicitJump.current = false })
    return result
  }, [originalScroll])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    let previousTop = element.scrollTop
    let movingDown = false
    let touching = false
    let previousTouchY = 0
    let selecting = false
    const updateDistance = (): number => {
      const next = getConversationScrollDistance(element.scrollHeight, element.clientHeight, element.scrollTop)
      setDistance((previous) => previous === next ? previous : next)
      return next
    }
    const settle = (): void => {
      const nextDistance = updateDistance()
      if (selecting || touching) return
      if (paused.current && canResumeConversationFollow(nextDistance, performance.now() - lastInput.current, movingDown)) {
        paused.current = false
        void originalScroll('instant')
      }
    }
    const pause = (towardBottom: boolean): void => {
      movingDown = towardBottom
      lastInput.current = performance.now()
      stopScroll()
      clearTimeout(timeout)
      timeout = setTimeout(settle, CONVERSATION_INPUT_COOLDOWN_MS + 1)
    }
    const nestedScrollable = (target: EventTarget | null): boolean => {
      let current = target instanceof Element ? target : null
      while (current && current !== element) {
        const style = getComputedStyle(current)
        if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return true
        current = current.parentElement
      }
      return false
    }
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && event.deltaY !== 0 && !nestedScrollable(event.target)) pause(event.deltaY > 0)
    }
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,button,[role="slider"]'))) return
      if (isConversationScrollKey(event)) pause(['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) && !(event.key === ' ' && event.shiftKey))
    }
    const onTouchStart = (event: TouchEvent): void => {
      if (nestedScrollable(event.target)) return
      touching = true
      previousTouchY = event.touches[0]?.clientY ?? 0
      pause(false)
    }
    const onTouchMove = (event: TouchEvent): void => {
      if (!touching) return
      const y = event.touches[0]?.clientY ?? previousTouchY
      pause(y < previousTouchY)
      previousTouchY = y
    }
    const onTouchEnd = (): void => { touching = false; settle() }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      const target = event.target
      if (target instanceof Element && target.closest('button,a,input,textarea,select,[role="button"],[role="separator"]')) return
      selecting = true
      pause(false)
    }
    const onPointerUp = (): void => {
      if (!selecting) return
      selecting = false
      const selection = window.getSelection()
      const selectedInside = selection && !selection.isCollapsed && selection.rangeCount > 0
        && element.contains(selection.getRangeAt(0).commonAncestorContainer)
      if (selectedInside) { movingDown = false; return }
      // 拖滚动条时最后一笔 scroll 常发生在 pointerup 之前，不能等另一笔
      // scroll 才恢复；文本选择仍保持暂停，不因松手抢回视口。
      settle()
      const remaining = CONVERSATION_INPUT_COOLDOWN_MS - (performance.now() - lastInput.current)
      if (movingDown && remaining >= 0) {
        clearTimeout(timeout)
        timeout = setTimeout(settle, remaining + 1)
      }
    }
    const onScroll = (): void => {
      const nextTop = element.scrollTop
      const nextDistance = updateDistance()
      const programmatic = original.state.ignoreScrollToTop === nextTop || explicitJump.current
      if (!programmatic && nextTop < previousTop - 0.5) {
        // 迷你地图、历史定位及原生滚动条也必须释放跟随。
        stopScroll()
        movingDown = false
      } else if (!programmatic && nextTop > previousTop + 0.5) {
        movingDown = true
      }
      previousTop = nextTop
      if (paused.current && nextDistance > 40) originalStop()
      settle()
    }
    element.addEventListener('wheel', onWheel, { passive: true, capture: true })
    element.addEventListener('keydown', onKey)
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: true })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', onTouchEnd, { passive: true })
    element.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    element.addEventListener('scroll', onScroll, { passive: true })
    const resize = new ResizeObserver(updateDistance)
    resize.observe(element)
    if (contentRef.current) resize.observe(contentRef.current)
    updateDistance()
    return () => {
      clearTimeout(timeout)
      resize.disconnect()
      element.removeEventListener('wheel', onWheel, true)
      element.removeEventListener('keydown', onKey)
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchEnd)
      element.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      element.removeEventListener('scroll', onScroll)
    }
  }, [scrollRef, contentRef, originalStop, originalScroll, original.state, stopScroll])

  // 库会把 70px near-bottom 合并进 isAtBottom；暂停后不可把这一近似值
  // 暴露给历史位置恢复，否则在 40–70px 区间补载历史会丢失锚点。
  return { instance: { ...original, isAtBottom: original.isAtBottom && !paused.current, stopScroll, scrollToBottom }, distance }
}
