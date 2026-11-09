import { PLANNING_IPC_CHANNELS } from '@gamma/shared'

export const PLANNING_REMOVED_ERROR = 'Todo 和日程功能已移除'

interface PlanningIpcRegistrar {
  handle(channel: string, listener: () => never): void
}

/** 兼容旧 renderer/preload 的请求，但绝不触达历史数据或 EventKit 权限。 */
export function registerRemovedPlanningHandlers(ipc: PlanningIpcRegistrar): void {
  for (const [name, channel] of Object.entries(PLANNING_IPC_CHANNELS)) {
    // 仅下行广播的通道不注册 invoke handler。
    if (name === 'CHANGED' || name === 'REMINDER_DUE' || name === 'AGENT_OPERATION') continue
    ipc.handle(channel, () => { throw new Error(PLANNING_REMOVED_ERROR) })
  }
}
