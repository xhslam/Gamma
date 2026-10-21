import { useEffect } from 'react'
import { useStore } from 'jotai'
import { toast } from 'sonner'
import { applyAgyTaskUpdateAtom, openAgyTaskAtom } from '@/atoms/agy-task-atoms'
import { agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily, agentSidePanelSplitMapAtom } from '@/atoms/agent-atoms'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'
import { getStopGenerationTarget } from '@/lib/stop-generation-target'
import { selectRightWorkspaceSplitTab } from '@/lib/right-workspace-split'

/** 常驻订阅，不依赖活动面板是否挂载；后台会话绝不改变当前焦点。 */
export function useAgyTaskListeners(): void {
  const store = useStore()
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAgyTaskUpdate(update => {
      store.set(applyAgyTaskUpdateAtom, update)
      const { sessionId, id } = update.task
      if (!update.reveal || store.get(activeSessionIdAtom) !== sessionId) return
      store.set(openAgyTaskAtom, { sessionId, taskId: id })
      store.set(agentDiffPanelTabAtom, previous => new Map(previous).set(sessionId, `agy:${id}`))
      store.set(agentSidePanelSplitMapAtom, previous => {
        const split = previous.get(sessionId)
        if (!split) return previous
        return new Map(previous).set(sessionId, selectRightWorkspaceSplitTab(split, `agy:${id}`))
      })
      store.set(agentSidePanelOpenAtomFamily(sessionId), true)
    })
    const stop = (event: Event): void => {
      const target = getStopGenerationTarget(event)
      if (target?.kind !== 'agy') return
      void window.electronAPI.stopAgyTask(target.sessionId, target.taskId)
        .then(task => store.set(applyAgyTaskUpdateAtom, { task, events: [] }))
        .catch(error => toast.error('停止 agy 任务失败', { description: error instanceof Error ? error.message : '未知错误' }))
    }
    window.addEventListener('gamma:stop-generation', stop)
    return () => { unsubscribe(); window.removeEventListener('gamma:stop-generation', stop) }
  }, [store])
}
