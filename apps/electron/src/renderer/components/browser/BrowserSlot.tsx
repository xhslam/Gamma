import * as React from 'react'
import { isPaneResizeProtected, PANE_RESIZE_GUARD_EVENT } from '@/lib/pane-resize-policy'
import { useAtomValue } from 'jotai'
import { agentSidePanelLayoutAtomFamily } from '@/atoms/agent-atoms'
import { nextBrowserLayoutRevision } from './browser-layout-revision'

// 每次 publish（包括卸载隐藏）分配全局单调 revision。旧 slot 的 IPC 即使晚到，
// 主进程也不会覆盖随后已挂载 tab 的可见性和边界。
// WebContentsView 是原生子视图，天然盖在 renderer DOM 之上；CSS z-index 无法反转。
// 它的可见性由 BrowserSlot 尺寸、Tab 生命周期与分栏拖动保护控制，不因为应用浮层
//（Dialog、Popover、Dropdown、Toast 等）出现而隐藏，避免右侧浏览器白屏。

export function BrowserSlot({ sessionId, tabId }: { sessionId: string; tabId: string }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)
  const workspaceSide = useAtomValue(agentSidePanelLayoutAtomFamily(sessionId)).workspaceSide === 'left' ? 'left' : 'right'

  React.useLayoutEffect(() => {
    const element = ref.current
    const setLayout = (window.electronAPI as Partial<typeof window.electronAPI>).setAgentBrowserLayout
    if (!element || typeof setLayout !== 'function') return
    // DOM 工作区保持固定内容宽度；原生视图不会自动服从父层的 overflow/inert。
    const transition = element.closest<HTMLElement>('[data-sidebar-transition]')
    let frame = 0
    const commitLayout = (visible: boolean, preserveSessionOnHide: boolean) => {
      const rect = element.getBoundingClientRect()
      const clip = transition?.getBoundingClientRect()
      const collapsed = transition?.dataset.collapsed === 'true'
      const left = Math.max(rect.left, clip?.left ?? rect.left)
      const right = Math.min(rect.right, clip?.right ?? rect.right)
      const width = Math.max(0, right - left)
      void setLayout({
        sessionId,
        tabId,
        revision: nextBrowserLayoutRevision(),
        visible: visible && !collapsed && !isPaneResizeProtected() && width > 4 && rect.height > 4,
        preserveSessionOnHide: preserveSessionOnHide || !!collapsed || isPaneResizeProtected(),
        bounds: {
          x: Math.round(left), y: Math.round(rect.y),
          width: Math.round(width), height: Math.round(rect.height),
        },
      })
    }
    const publish = (visible: boolean, preserveSessionOnHide = false, immediate = false) => {
      if (frame) cancelAnimationFrame(frame)
      if (immediate) {
        frame = 0
        commitLayout(visible, preserveSessionOnHide)
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        commitLayout(visible, preserveSessionOnHide)
      })
    }
    const publishCurrentVisibility = (immediate = false) => publish(true, false, immediate)
    const observer = new ResizeObserver(() => publishCurrentVisibility())
    const publishBounded = () => publishCurrentVisibility()
    const publishResizeGuard = () => {
      if (isPaneResizeProtected()) publish(false, true, true)
      else publishCurrentVisibility()
    }
    window.addEventListener(PANE_RESIZE_GUARD_EVENT, publishResizeGuard)
    observer.observe(element)
    if (transition) observer.observe(transition)
    // 左侧导航收放会移动左侧工作区，但浏览器自身尺寸可能保持不变。
    const workspaceLayout = element.closest<HTMLElement>('.gamma-workspace-layout')
    if (workspaceLayout) observer.observe(workspaceLayout)
    const visibilityObserver = new MutationObserver(() => publishCurrentVisibility(true))
    if (transition) visibilityObserver.observe(transition, { attributes: true, attributeFilter: ['data-collapsed'] })
    window.addEventListener('resize', publishBounded)
    // Tab 切换时先前 Slot 会立即发出 hide。新 Slot 不能再等一帧才 show，
    // 否则快速左右切换时原生视图会停留在隐藏状态，表现为页面内容消失。
    publishCurrentVisibility(true)
    return () => {
      observer.disconnect()
      visibilityObserver.disconnect()
      window.removeEventListener('resize', publishBounded)
      window.removeEventListener(PANE_RESIZE_GUARD_EVENT, publishResizeGuard)
      if (frame) cancelAnimationFrame(frame)
      void setLayout({ sessionId, tabId, revision: nextBrowserLayoutRevision(), visible: false, preserveSessionOnHide: false, bounds: { x: 0, y: 0, width: 0, height: 0 } })
    }
    // 交换位置可能只改变坐标而不改变尺寸，ResizeObserver 无法捕获这次移动。
  }, [sessionId, tabId, workspaceSide])

  return <div ref={ref} className="flex-1 min-h-0 bg-muted/15 titlebar-no-drag" aria-label="受管浏览器页面" />
}
