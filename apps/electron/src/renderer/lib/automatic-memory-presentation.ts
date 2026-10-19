import type { AutomaticMemoryCategory, AutomaticMemoryChange, AutomaticMemoryEntry, AutomaticMemorySource } from '@gamma/shared'

export const AUTOMATIC_MEMORY_CATEGORIES: ReadonlyArray<{ key: AutomaticMemoryCategory; label: string }> = [
  { key: 'profile', label: '个人偏好' },
  { key: 'topics', label: '主题' },
  { key: 'areas', label: '领域' },
  { key: 'people', label: '人物' },
]

/** 搜索仅匹配当前工作区已加载的标题与正文，不读取额外文件。 */
export function filterAutomaticMemoryEntries(entries: AutomaticMemoryEntry[], query: string): AutomaticMemoryEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return entries
  return entries.filter((entry) => `${entry.title}\n${entry.content}`.toLocaleLowerCase().includes(normalized))
}

/** 包含来源和保存时刻，关闭旧提示不会屏蔽同条记忆的后续更新。 */
export function automaticMemoryChangeKey(change: AutomaticMemoryChange): string {
  return JSON.stringify([change.workspaceSlug, change.entryId, change.changedAt, change.source.kind, change.source.sessionId, change.source.messageId])
}

/** 提示只来自已提交事件；重订阅和重复广播不能重复展示。 */
export function appendAutomaticMemoryChange(previous: AutomaticMemoryChange[], change: AutomaticMemoryChange): AutomaticMemoryChange[] {
  const duplicate = previous.some((item) => item.workspaceSlug === change.workspaceSlug && item.entryId === change.entryId
    && item.changedAt === change.changedAt && item.source.kind === change.source.kind
    && item.source.sessionId === change.source.sessionId && item.source.messageId === change.source.messageId)
  return duplicate ? previous : [...previous, change].slice(-100)
}

export function selectAutomaticMemoryChanges(changes: AutomaticMemoryChange[], kind: AutomaticMemorySource['kind'], sessionId: string, workspaceSlug?: string): AutomaticMemoryChange[] {
  return changes.filter((change) => change.source.kind === kind && change.source.sessionId === sessionId
    && (!workspaceSlug || change.workspaceSlug === workspaceSlug)).slice(-8)
}
