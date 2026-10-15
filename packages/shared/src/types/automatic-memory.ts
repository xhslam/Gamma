/** 工作区自动记忆的产品契约；记忆正文是数据，不是权限指令。 */
export type AutomaticMemoryCategory = 'profile' | 'topics' | 'areas' | 'people'

export interface AutomaticMemorySource {
  kind: 'chat' | 'agent'
  sessionId: string
  messageId: string
  createdAt: number
}

export interface AutomaticMemoryFact {
  key: string
  content: string
  evidence: string
  sensitive: boolean
  updatedAt: number
  source: AutomaticMemorySource
}

export interface AutomaticMemoryEntry {
  id: string
  category: AutomaticMemoryCategory
  title: string
  content: string
  facts: AutomaticMemoryFact[]
  revision: number
  createdAt: number
  updatedAt: number
  manuallyEdited: boolean
}

export interface AutomaticMemorySettings {
  enabled: boolean
  includeSensitive: boolean
}

export interface AutomaticMemorySnapshot {
  settings: AutomaticMemorySettings
  entries: AutomaticMemoryEntry[]
  revision: number
  /** 策略/手动操作代数；自动事实提交不推进，用于取消入队前的旧任务。 */
  policyRevision?: number
}

export interface AutomaticMemoryCandidate {
  category: AutomaticMemoryCategory
  title: string
  /** 同一主题内实体/属性的稳定键，用于事实级更新。 */
  key: string
  content: string
  /** 必须是本轮用户原文中的连续片段，不允许以助手/网页为证据。 */
  evidence: string
  sensitive: boolean
}

export interface AutomaticMemoryChange {
  workspaceSlug: string
  source: AutomaticMemorySource
  entryId: string
  title: string
  category: AutomaticMemoryCategory
  action: 'added' | 'updated'
  changedAt: number
}

export const AUTOMATIC_MEMORY_IPC_CHANNELS = {
  GET: 'automatic-memory:get',
  SETTINGS: 'automatic-memory:settings',
  EDIT: 'automatic-memory:edit',
  DELETE: 'automatic-memory:delete',
  CHANGED: 'automatic-memory:changed',
} as const
