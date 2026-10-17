import { atom } from 'jotai'
import type { ComputerState } from '@gamma/shared'
import { projectComputerState } from '../components/computer-use/computer-use-model'
import type { ComputerUseView } from '../components/computer-use/computer-use-model'

/** 状态 UI 没有启用、选窗或系统授权能力；授权由 Agent 首次使用时引导。 */
export interface ComputerUseAPI {
  getComputerState: (sessionId?: string) => Promise<ComputerState>
  stopComputer: () => Promise<ComputerState>
}

export const computerUseApiAtom = atom<ComputerUseAPI>({
  getComputerState: (sessionId) => window.electronAPI.getComputerState(sessionId),
  stopComputer: () => window.electronAPI.stopComputer(),
})

/** 只控制状态详情的展开，不影响 Agent 的工具可用性。 */
export const computerUsePanelOpenAtom = atom(false)
export const computerUseViewAtom = atom<ComputerUseView>({
  sessionId: null, state: null, loading: false, pending: null, error: null,
})
const readEpochAtom = atom(0)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '无法同步桌面状态，请重试读取。'
}

/** 事件只触发重新读取；始终使用当前会话，不使用事件传入的会话上下文。 */
export const refreshComputerUseAtom = atom(null, async (get, set) => {
  const sessionId = get(computerUseViewAtom).sessionId
  const epoch = get(readEpochAtom) + 1
  set(readEpochAtom, epoch)
  set(computerUseViewAtom, (view) => ({ ...view, loading: true, error: null }))
  try {
    const state = projectComputerState(await get(computerUseApiAtom).getComputerState(sessionId ?? undefined))
    if (get(readEpochAtom) !== epoch) return
    set(computerUseViewAtom, (view) => ({ ...view, state, loading: false }))
  } catch (error) {
    if (get(readEpochAtom) !== epoch) return
    // 保留上次控制线索；即使读取失败，独立停止按钮仍可使用。
    set(computerUseViewAtom, (view) => ({ ...view, loading: false, error: errorMessage(error) }))
  }
})

export const selectComputerSessionAtom = atom(null, (_get, set, sessionId: string | null) => {
  // 全局控制不会随着 UI 切换会话转移；保留状态以便随时停止。
  set(computerUseViewAtom, (view) => ({ ...view, sessionId }))
  return set(refreshComputerUseAtom)
})

export const stopComputerUseAtom = atom(null, async (get, set) => {
  if (get(computerUseViewAtom).pending === 'stop') return
  // 停止不等待读取完成；旧读取不得把 active 状态恢复回来。
  set(readEpochAtom, get(readEpochAtom) + 1)
  set(computerUseViewAtom, (view) => ({ ...view, pending: 'stop', loading: false, error: null }))
  try {
    const state = projectComputerState(await get(computerUseApiAtom).stopComputer())
    // 让停止期间发出的读取也失效，停止响应是本次操作的最终状态。
    set(readEpochAtom, get(readEpochAtom) + 1)
    set(computerUseViewAtom, (view) => ({ ...view, state, pending: null, loading: false }))
  } catch (error) {
    set(readEpochAtom, get(readEpochAtom) + 1)
    set(computerUseViewAtom, (view) => ({ ...view, pending: null, loading: false, error: errorMessage(error) }))
  }
})
