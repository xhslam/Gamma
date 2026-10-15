import { atom } from 'jotai'
import type { AutomaticMemoryChange } from '@gamma/shared'

/** 仅当前 renderer 生命周期的真实保存提示，不持久化或模拟历史结果。 */
export const automaticMemoryChangesAtom = atom<AutomaticMemoryChange[]>([])
export const automaticMemoryNavigationAtom = atom<{ workspaceSlug: string; entryId: string } | null>(null)
