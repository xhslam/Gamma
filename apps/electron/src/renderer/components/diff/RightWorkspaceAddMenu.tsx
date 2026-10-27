import * as React from 'react'
import { Blocks, BookOpen, Brain, CalendarDays, Clock, FolderOpen, Globe, ListTodo, Plus, ServerCog, SquareTerminal } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { WorkspaceComponentTab } from '@/atoms/agent-atoms'
import type { ProductivityToolsSettings } from '@/types/settings'

export interface RightWorkspaceAddMenuProps {
  workspaceSide?: 'left' | 'right'
  onOpenBrowser: () => void
  onOpenFile: () => void
  onOpenTerminal?: () => void
  onOpenAgyTasks?: () => void
  onOpenWorkspaceComponent?: (component: WorkspaceComponentTab) => void
  productivityTools?: ProductivityToolsSettings
  onOpenChange?: (open: boolean) => void
}

/** 标题栏与工作区共用添加入口，选择内容后才创建和展开标签。 */
export function RightWorkspaceAddMenu({
  workspaceSide = 'right', onOpenBrowser, onOpenFile, onOpenTerminal,
  onOpenAgyTasks, onOpenWorkspaceComponent,
  productivityTools = { todosEnabled: true, calendarEnabled: true }, onOpenChange,
}: RightWorkspaceAddMenuProps): React.ReactElement {
  const [isAddTabMenuOpen, setIsAddTabMenuOpen] = React.useState(false)
  const suppressPointerDismissFocusRestoreRef = React.useRef(false)
  React.useEffect(() => () => onOpenChange?.(false), [onOpenChange])
  const handleOpenChange = React.useCallback((open: boolean) => {
    if (open) suppressPointerDismissFocusRestoreRef.current = false
    setIsAddTabMenuOpen(open)
    onOpenChange?.(open)
  }, [onOpenChange])
  return (
    <DropdownMenu open={isAddTabMenuOpen} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button data-icon-button="true"
              type="button"
              data-testid="add-workspace-button"
              className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] hover:bg-muted hover:text-foreground"
              aria-label={`添加${workspaceSide === 'left' ? '左侧' : '右侧'}工作区标签`}
            >
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">添加标签</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="z-[100] min-w-40 titlebar-no-drag"
        onPointerDownOutside={() => { suppressPointerDismissFocusRestoreRef.current = true }}
        onCloseAutoFocus={(event) => {
          if (!suppressPointerDismissFocusRestoreRef.current) return
          suppressPointerDismissFocusRestoreRef.current = false
          event.preventDefault()
        }}
      >
        <DropdownMenuItem onSelect={() => onOpenBrowser()}>
          <Globe className="size-3.5" />
          新建浏览器标签
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpenFile()}>
          <FolderOpen className="size-3.5" />
          打开文件
        </DropdownMenuItem>
        {onOpenAgyTasks && <DropdownMenuItem onSelect={() => onOpenAgyTasks()}><SquareTerminal className="size-3.5" />外部任务 · agy</DropdownMenuItem>}
        {onOpenTerminal && (
          <DropdownMenuItem onSelect={() => onOpenTerminal()}>
            <SquareTerminal className="size-3.5" />
            新建终端
          </DropdownMenuItem>
        )}
        {onOpenWorkspaceComponent && (
          <>
            <DropdownMenuSeparator />
            {productivityTools.todosEnabled && (
              <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('todos')}>
                <ListTodo className="size-3.5" />
                打开 Todo
              </DropdownMenuItem>
            )}
            {productivityTools.calendarEnabled && (
              <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('calendar')}>
                <CalendarDays className="size-3.5" />
                打开日程
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('markdown')}><BookOpen className="size-3.5" />打开 Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('skills')}>
              <Blocks className="size-3.5" />
              打开 Skills
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('mcp')}>
              <ServerCog className="size-3.5" />
              打开 MCP
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('memory')}>
              <Brain className="size-3.5" />
              打开项目记忆
            </DropdownMenuItem>
          </>
        )}
        {onOpenWorkspaceComponent && (
          <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('automations')}>
            <Clock className="size-3.5" />
            打开定时任务
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
