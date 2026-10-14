import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { PanelLeft } from 'lucide-react'
import { activeTabAtom, sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'
import { detectIsMac } from '@/lib/platform'
import { cn } from '@/lib/utils'

/** 收起侧栏后仅保留一行标题与展开入口，不再占用左侧内容空间。 */
export function CollapsedSidebarHeader(): React.ReactElement {
  const setCollapsed = useSetAtom(sidebarCollapsedAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const activeView = useAtomValue(activeViewAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const session = activeTab?.type === 'agent'
    ? sessions.find((item) => item.id === activeTab.sessionId)
    : undefined
  const title = activeView === 'planning' ? '规划'
    : activeView === 'agent-skills' ? 'MCP / Skills'
      : activeView === 'markdown' ? 'Markdown'
        : session?.title || activeTab?.title || 'Gamma'

  return (
    <header
      data-testid="collapsed-sidebar-header"
      className={cn(
        'relative z-[60] flex h-11 shrink-0 items-center gap-2 bg-content-area pr-4 titlebar-drag-region',
        detectIsMac() ? 'pl-20' : 'pl-3',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="展开侧边栏"
            aria-expanded={false}
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground titlebar-no-drag"
            onClick={() => setCollapsed(false)}
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="flex items-center gap-2">
            <span>展开侧边栏</span>
            <ShortcutKeycaps shortcutId="toggle-sidebar" keycapClassName="h-5 min-w-5 px-1 text-[11px]" separatorClassName="text-[10px]" />
          </span>
        </TooltipContent>
      </Tooltip>
      <span className="min-w-0 truncate text-sm font-medium text-foreground/85" title={title}>{title}</span>
    </header>
  )
}
