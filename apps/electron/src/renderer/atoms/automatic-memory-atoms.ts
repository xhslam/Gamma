import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { AutomaticMemoryCategory, AutomaticMemoryChange } from '@gamma/shared'

/** 仅当前 renderer 生命周期的真实保存提示，不持久化或模拟历史结果。 */
export const automaticMemoryChangesAtom = atom<AutomaticMemoryChange[]>([])
/** 仅隐藏已关闭的保存提示；跨组件重挂载保留，不修改实际记忆。 */
export const dismissedAutomaticMemoryChangesAtom = atom<ReadonlySet<string>>(new Set<string>())
export const automaticMemoryNavigationAtom = atom<{ workspaceSlug: string; entryId: string } | null>(null)

export interface AutomaticMemoryPanelState {
  open: boolean
  settingsOpen: boolean
  query: string
  collapsedCategories: AutomaticMemoryCategory[]
  expandedEntries: string[]
}

/** 按工作区保留浏览状态，不持久化正文或改变记忆授权。 */
export const automaticMemoryPanelStateAtomFamily = atomFamily((_workspaceSlug: string) => atom<AutomaticMemoryPanelState>({
  open: true,
  settingsOpen: false,
  query: '',
  collapsedCategories: [],
  expandedEntries: [],
}))
