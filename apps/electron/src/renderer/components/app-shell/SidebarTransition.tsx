import * as React from 'react'

interface SidebarTransitionProps {
  collapsed: boolean
  width: number
  children: React.ReactNode
}

/** 保持导航挂载及固定内容宽度，仅让外壳占用空间平滑变化。 */
export function SidebarTransition({ collapsed, width, children }: SidebarTransitionProps): React.ReactElement {
  return (
    <div
      aria-hidden={collapsed || undefined}
      {...(collapsed ? { inert: '' } : {})}
      className="relative z-[60] min-h-0 shrink-0 overflow-hidden crt-sidebar transition-[width,visibility] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{
        width: collapsed ? 0 : width,
        visibility: collapsed ? 'hidden' : 'visible',
        // 收起后再隐藏；展开时立即可见。CSS 过渡支持中途反向切换，无需定时器。
        transitionDelay: collapsed ? '0ms, 220ms' : '0ms, 0ms',
      }}
    >
      <div
        className={`flex h-full transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${collapsed ? '-translate-x-3 opacity-0' : 'translate-x-0 opacity-100'}`}
        style={{ width }}
      >
        <div className="h-full shrink-0" style={{ width }}>{children}</div>
      </div>
    </div>
  )
}
