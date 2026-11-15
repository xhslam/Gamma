import * as React from 'react'
import { cn } from '@/lib/utils'
import type { WorkspaceSide } from './right-panel-layout'
import { SidebarTransition } from './SidebarTransition'

interface WorkspacePanelsProps {
  agent: React.ReactNode
  workspace: React.ReactNode | null
  workspaceSide: WorkspaceSide
  workspaceOpen: boolean
  workspaceMaximized?: boolean
  workspaceWidth: number
  minimumWidth: number
  maximumWidth: number
  resizing?: boolean
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

/** 通过稳定的 key 移动面板，保留编辑草稿与浏览器实例；DOM 顺序同时跟随视觉顺序。 */
export function WorkspacePanels({ agent, workspace, workspaceSide, workspaceOpen, workspaceMaximized = false, workspaceWidth, minimumWidth, maximumWidth, resizing = false, onResizeStart, onResizeKeyDown }: WorkspacePanelsProps): React.ReactElement {
  const panes = [
    <div key="agent" data-workspace-pane="agent" hidden={workspaceMaximized} className={cn('relative z-[60] min-h-0 min-w-0 flex-1 flex-col overflow-hidden', workspaceMaximized ? 'hidden' : 'flex')}>{agent}</div>,
  ]
  if (workspace !== null) {
    const workspacePane = (
      <div key="workspace" data-workspace-pane="workspace" data-workspace-open={workspaceOpen} data-workspace-side={workspaceSide} data-workspace-maximized={workspaceMaximized} className="relative z-[61] flex min-h-0 flex-shrink-0 items-stretch crt-sidebar">
        {workspaceOpen && (
          <div
            role="separator"
            aria-label={workspaceMaximized ? '拖动恢复分栏' : '调整工作区宽度'}
            title={workspaceMaximized ? '向内拖动恢复分栏' : '拖到窗口边缘可最大化工作区'}
            aria-orientation="vertical"
            aria-valuemin={Math.round(Math.min(minimumWidth, maximumWidth))}
            aria-valuemax={Math.round(maximumWidth)}
            aria-valuenow={Math.round(workspaceWidth)}
            aria-valuetext={`${Math.round(workspaceWidth)} 像素`}
            tabIndex={0}
            className={cn(
              'absolute inset-y-0 z-[62] w-2 touch-none cursor-col-resize titlebar-no-drag transition-colors hover:bg-primary/20 active:bg-primary/50 focus-visible:bg-primary/20 focus-visible:outline-none',
              workspaceSide === 'left' ? 'right-0' : 'left-0',
              workspaceMaximized ? 'bg-border/40' : workspaceSide === 'left' ? 'translate-x-full' : '-translate-x-full',
            )}
            onPointerDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
          />
        )}
        <SidebarTransition collapsed={!workspaceOpen} width={workspaceWidth} resizing={resizing} region="workspace">
          {workspace}
        </SidebarTransition>
      </div>
    )
    if (workspaceSide === 'left') panes.unshift(workspacePane)
    else panes.push(workspacePane)
  }
  // 列布局中的 flex 子项必须允许纵向收缩；面板再通过 flex 传递剩余高度，
  // 否则 h-full 子树会按长内容计算高度，挤出输入框并使内部滚动失效。
  return <div className="gamma-workspace-layout flex min-h-0 min-w-0 flex-1 items-stretch" data-workspace-open={workspace !== null && workspaceOpen} data-testid="agent-workspace-layout">{panes}</div>
}
