import { flushSync } from 'react-dom'

/** 分栏拖动只有超过死区后才提交；点击分隔条不会污染持久化布局。 */
export const PANE_RESIZE_DEADZONE = 4
export const PANE_RESIZE_GUARD_EVENT = 'gamma:pane-resize-guard'
let activeGuards = 0
export function isPaneResizeProtected(): boolean { return activeGuards > 0 }
export function hasPaneResizeStarted(startX: number, clientX: number): boolean {
  return Number.isFinite(clientX) && Math.abs(clientX - startX) > PANE_RESIZE_DEADZONE
}

interface PaneResizeOptions {
  target: HTMLElement
  pointerId: number
  startX: number
  move: (clientX: number) => void
  finish: (commit: boolean) => void
}

/** 原生视图由 BrowserSlot 通过既有布局契约隐藏；DOM shield 只负责 iframe。 */
export function beginPaneResize({ target, pointerId, startX, move, finish }: PaneResizeOptions): () => void {
  let started = false
  let finished = false
  const cursor = document.body.style.cursor
  const userSelect = document.body.style.userSelect
  const shield = document.createElement('div')
  shield.dataset.paneResizeShield = ''
  shield.setAttribute('aria-hidden', 'true')
  shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:col-resize;touch-action:none;background:transparent'
  const notify = () => window.dispatchEvent(new Event(PANE_RESIZE_GUARD_EVENT))
  // 从按下即保护原生视图，避免跨越死区前指针进入 WebContentsView。
  activeGuards++
  notify()
  document.body.append(shield)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const end = (commit: boolean) => {
    if (finished) return
    finished = true
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    document.removeEventListener('keydown', onKey, true)
    target.removeEventListener('lostpointercapture', onCancel)
    window.removeEventListener('blur', cancel)
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    shield.remove()
    document.body.style.cursor = cursor
    document.body.style.userSelect = userSelect
    // 先恢复布局，再让原生宿主下一帧同步最终位置。
    try {
      finish(commit && started)
    } finally {
      activeGuards--
      notify()
    }
  }
  const cancel = () => end(false)
  const onCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) cancel() }
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    started ||= hasPaneResizeStarted(startX, event.clientX)
    if (started) move(event.clientX)
  }
  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    onMove(event)
    end(true)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', onCancel)
  document.addEventListener('keydown', onKey, true)
  target.addEventListener('lostpointercapture', onCancel)
  window.addEventListener('blur', cancel)
  // 合成事件没有活跃 pointer，真实原生输入才允许 capture。
  try { target.setPointerCapture(pointerId) } catch { /* 合成测试或指针已结束。 */ }
  return cancel
}

/** 将持久布局和拖动预览切换合并为一次渲染，避免松手时短暂回到旧尺寸。 */
export function commitPaneResize(commitLayout: () => void, clearPreview: () => void): void {
  flushSync(() => {
    commitLayout()
    clearPreview()
  })
}
