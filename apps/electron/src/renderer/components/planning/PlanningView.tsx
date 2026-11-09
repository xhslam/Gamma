import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { automationsAtom, automationFormAtom, createEmptyDraft } from '@/atoms/automation-atoms'
import type { PlanningTab } from '@/atoms/planning-atoms'
import { AutomationsListView } from '@/components/automation/AutomationsListView'
import { AgentActionHint } from '@/components/agent/AgentActionHint'
import { useShortcut } from '@/hooks/useShortcut'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'

/** 保留旧组件参数兼容已恢复的工作区；Todo / 日程请求统一展示定时任务。 */
export function PlanningView({
  embedded = false,
}: { embedded?: boolean; componentTab?: PlanningTab } = {}): React.ReactElement {
  const automations = useAtomValue(automationsAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const createAutomation = React.useCallback((): void => {
    let maxN = 0
    for (const automation of automations) {
      const match = /^定时任务\s*(\d+)$/.exec(automation.name.trim())
      if (match) maxN = Math.max(maxN, Number(match[1]))
    }
    const draft = createEmptyDraft()
    draft.name = `定时任务 ${maxN + 1}`
    setAutomationForm({ open: true, draft })
  }, [automations, setAutomationForm])

  useShortcut('new-session', createAutomation, true, { exclusive: true })
  return (
    <div className="flex h-full flex-col overflow-hidden bg-content-area">
      <header className={cn('relative flex w-full items-center justify-between titlebar-no-drag', embedded ? 'px-4 py-3' : 'px-6 pb-5 pt-8 sm:px-8 xl:px-10')}>
        <div className="absolute inset-y-0 left-0 z-0 titlebar-drag-region right-0" />
        <div className="relative z-[1]">
          <h1 className={cn('font-semibold tracking-tight text-wrap-balance', embedded ? 'text-lg' : 'text-2xl')}>定时任务</h1>
          <p className={cn('text-muted-foreground', embedded ? 'mt-0.5 text-xs' : 'mt-1 text-sm')}>持续运行的自动任务</p>
        </div>
        <div className="relative z-[1] titlebar-no-drag flex items-center gap-2">
          {automations.length > 0 && (
            <button
              type="button"
              onClick={createAutomation}
              aria-keyshortcuts="Meta+N Control+N"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <Plus size={16} /> 新建定时任务
              <ShortcutKeycaps
                shortcutId="new-session"
                className="ml-1.5"
                keycapClassName="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground shadow-none"
                separatorClassName="text-primary-foreground/70"
              />
            </button>
          )}
        </div>
      </header>
      {embedded && (
        <div className="titlebar-no-drag shrink-0 px-3 pb-3">
          <AgentActionHint action="创建、调整、暂停或删除定时任务" />
        </div>
      )}
      <main className={cn('min-h-0 flex-1 overflow-y-auto titlebar-no-drag', embedded ? 'px-3 pb-3' : 'px-6 pb-8 pt-6 sm:px-8 xl:px-10')}>
        <div className="w-full"><AutomationsListView /></div>
      </main>
    </div>
  )
}
