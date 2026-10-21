import { atom } from 'jotai'
import type { AgyActivityEvent, AgyTask, AgyTaskUpdate } from '@gamma/shared'

/** 每个已观察任务的时间线最多保留 2000 条；完整记录仍由主进程分页提供。 */
export const AGY_EVENT_LIMIT = 2000
export interface AgyTaskView {
  task: AgyTask
  events: AgyActivityEvent[]
  clipped: boolean
}
export interface AgyTaskViewUpdate extends AgyTaskUpdate {
  /** 快照在同序号、同状态下不能覆盖已到达的订阅元数据。 */
  source?: 'snapshot'
}
export const agyTaskViewsAtom = atom<Map<string, AgyTaskView>>(new Map())
export const agyOpenTaskIdsAtom = atom<Map<string, string[]>>(new Map())
export function agyTaskKey(sessionId: string, taskId: string): string {
  return JSON.stringify([sessionId, taskId])
}
export function isAgyTaskActive(task: AgyTask): boolean {
  return task.status === 'starting' || task.status === 'running' || task.status === 'stopping'
}

/** 快照可能晚于订阅到达；终态和更大的序号不能被旧快照回退。 */
export function mergeAgyTaskView(previous: AgyTaskView | undefined, update: AgyTaskViewUpdate): AgyTaskView {
  const oldTask = previous?.task
  const incoming = update.task
  const oldRank = oldTask ? (isAgyTaskActive(oldTask) ? oldTask.status === 'stopping' ? 2 : oldTask.status === 'running' ? 1 : 0 : 3) : -1
  const newRank = isAgyTaskActive(incoming) ? incoming.status === 'stopping' ? 2 : incoming.status === 'running' ? 1 : 0 : 3
  const keepOld = oldTask && (oldTask.lastSequence > incoming.lastSequence || (oldTask.lastSequence === incoming.lastSequence && (oldRank > newRank || (update.source === 'snapshot' && oldRank === newRank))))
  const events = new Map((previous?.events ?? []).map(event => [event.sequence, event]))
  for (const event of update.events) if (!events.has(event.sequence)) events.set(event.sequence, event)
  const sorted = [...events.values()].sort((left, right) => left.sequence - right.sequence)
  return {
    task: keepOld ? oldTask : incoming,
    events: sorted.slice(-AGY_EVENT_LIMIT),
    clipped: !!previous?.clipped || sorted.length > AGY_EVENT_LIMIT,
  }
}
export const applyAgyTaskUpdateAtom = atom(null, (get, set, update: AgyTaskViewUpdate) => {
  const key = agyTaskKey(update.task.sessionId, update.task.id)
  const previous = get(agyTaskViewsAtom)
  set(agyTaskViewsAtom, new Map(previous).set(key, mergeAgyTaskView(previous.get(key), update)))
})
export const openAgyTaskAtom = atom(null, (get, set, input: { sessionId: string; taskId: string }) => {
  const previous = get(agyOpenTaskIdsAtom)
  const ids = previous.get(input.sessionId) ?? []
  if (!ids.includes(input.taskId)) set(agyOpenTaskIdsAtom, new Map(previous).set(input.sessionId, [...ids, input.taskId]))
})
export const closeAgyTaskAtom = atom(null, (get, set, input: { sessionId: string; taskId: string }) => {
  const previous = get(agyOpenTaskIdsAtom)
  set(agyOpenTaskIdsAtom, new Map(previous).set(input.sessionId, (previous.get(input.sessionId) ?? []).filter(id => id !== input.taskId)))
})
