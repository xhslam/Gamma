import * as React from 'react'

interface SidebarTransitionProps {
  collapsed: boolean
  width: number
  children: React.ReactNode
  resizing?: boolean
  region?: 'navigation' | 'workspace'
}

/** 两侧共用收放动画；内容固定宽度并持续挂载，拖动调宽时直接跟随指针。 */
export function SidebarTransition({ collapsed, width, children, resizing = false, region = 'navigation' }: SidebarTransitionProps): React.ReactElement {
  return (
    <div
      aria-hidden={collapsed || undefined}
      {...(collapsed ? { inert: '' } : {})}
      data-sidebar-transition=""
      data-sidebar-region={region}
      data-collapsed={collapsed}
      data-resizing={resizing}
      className="gamma-sidebar-transition relative z-[60] min-h-0 shrink-0 overflow-hidden crt-sidebar"
      style={{ width: collapsed ? 0 : width }}
    >
      <div
        data-sidebar-transition-content=""
        className="flex h-full"
        style={{ width }}
      >
        <div className="h-full shrink-0" style={{ width }}>{children}</div>
      </div>
    </div>
  )
}
