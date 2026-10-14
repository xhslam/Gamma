import * as React from 'react'
import { cn } from '@/lib/utils'
import type { WorkspaceSide } from './right-panel-layout'

interface WorkspacePanelsProps {
  agent: React.ReactNode
  workspace: React.ReactNode | null
  workspaceSide: WorkspaceSide
  workspaceOpen: boolean
  workspaceWidth: number
  minimumWidth: number
  maximumWidth: number
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

/** 通过稳定的 key 移动面板，保留编辑草稿与浏览器实例；DOM 顺序同时跟随视觉顺序。 */
export function WorkspacePanels({ agent, workspace, workspaceSide, workspaceOpen, workspaceWidth, minimumWidth, maximumWidth, onResizeStart, onResizeKeyDown }: WorkspacePanelsProps): React.ReactElement {
  const panes = [
    <div key="agent" data-workspace-pane="agent" className="relative z-[60] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{agent}</div>,
  ]
  if (workspace !== null) {
    const workspacePane = (
      <div key="workspace" data-workspace-pane="workspace" data-workspace-side={workspaceSide} className="relative z-[60] flex min-h-0 flex-shrink-0 items-stretch crt-sidebar">
        <div aria-hidden="true" className={cn('pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-border/80 dark:bg-border/70', workspaceSide === 'left' ? 'right-0' : 'left-0')} />
        {workspaceOpen && (
          <div
            role="separator"
            aria-label="调整工作区宽度"
            aria-orientation="vertical"
            aria-valuemin={Math.round(Math.min(minimumWidth, maximumWidth))}
            aria-valuemax={Math.round(maximumWidth)}
            aria-valuenow={Math.round(workspaceWidth)}
            aria-valuetext={`${Math.round(workspaceWidth)} 像素`}
            tabIndex={0}
            className={cn('absolute top-0 bottom-0 w-2 cursor-col-resize active:bg-primary/50 transition-colors z-20 focus-visible:bg-primary/20 focus-visible:outline-none', workspaceSide === 'left' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2')}
            onMouseDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
          />
        )}
        {workspace}
      </div>
    )
    if (workspaceSide === 'left') panes.unshift(workspacePane)
    else panes.push(workspacePane)
  }
  // 列布局中的 flex 子项必须允许纵向收缩；面板再通过 flex 传递剩余高度，
  // 否则 h-full 子树会按长内容计算高度，挤出输入框并使内部滚动失效。
  return <div className="flex min-h-0 min-w-0 flex-1 items-stretch" data-testid="agent-workspace-layout">{panes}</div>
}
