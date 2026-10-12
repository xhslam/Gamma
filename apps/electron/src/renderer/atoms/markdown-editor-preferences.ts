import { atom } from 'jotai'
import type { Getter, Setter } from 'jotai'
import {
  DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
  mergeMarkdownEditorPreferences,
  normalizeMarkdownEditorPreferences,
} from '@gamma/shared'
import type { MarkdownEditorPreferences, MarkdownEditorPreferencesUpdate } from '@gamma/shared'

/** 可见偏好立即更新；主进程确认值仅用于失败恢复。 */
export const markdownEditorPreferencesAtom = atom<MarkdownEditorPreferences>(
  normalizeMarkdownEditorPreferences(DEFAULT_MARKDOWN_EDITOR_PREFERENCES),
)
export const markdownEditorPreferencesErrorAtom = atom<string | null>(null)

const confirmedPreferencesAtom = atom<MarkdownEditorPreferences>(
  normalizeMarkdownEditorPreferences(DEFAULT_MARKDOWN_EDITOR_PREFERENCES),
)
interface PreferencesIntent {
  revision: number
  updates: MarkdownEditorPreferencesUpdate
}
const preferencesInitializedAtom = atom(false)
/** 保留尚未确认的操作；中间保存失败后，下一次完整快照仍包含这些修改。 */
const preferencesIntentsAtom = atom<PreferencesIntent[]>([])
const preferencesRevisionAtom = atom(0)
const pendingSavesAtom = atom(0)
/** 队列保存在 atom 中，每个 Jotai store 独立串行化。 */
const preferencesQueueAtom = atom<Promise<void>>(Promise.resolve())

export const markdownEditorPreferencesSavingAtom = atom(get => get(pendingSavesAtom) > 0)

function enqueuePreferencesOperation(get: Getter, set: Setter, operation: () => Promise<void>): Promise<void> {
  const request = get(preferencesQueueAtom).then(operation)
  // 队列尾部恢复可继续执行；请求本身仍返回原 rejection 给调用方。
  set(preferencesQueueAtom, request.then(() => undefined, () => undefined))
  return request
}

function preferencesErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function replayPreferencesIntents(base: MarkdownEditorPreferences, intents: readonly PreferencesIntent[]): MarkdownEditorPreferences {
  return intents.reduce((preferences, intent) => mergeMarkdownEditorPreferences(preferences, intent.updates), base)
}

function refreshVisiblePreferences(get: Getter, set: Setter): void {
  set(markdownEditorPreferencesAtom, replayPreferencesIntents(get(confirmedPreferencesAtom), get(preferencesIntentsAtom)))
}

async function readConfirmedPreferences(get: Getter, set: Setter): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  set(confirmedPreferencesAtom, normalizeMarkdownEditorPreferences(settings.markdownEditor))
  set(preferencesInitializedAtom, true)
  // 首次加载返回时重放期间的用户修改，保留磁盘中未修改的偏好。
  refreshVisiblePreferences(get, set)
}

/** 与保存共用队列；加载结果作为底稿，尚未确认的修改始终保留在上层。 */
export const loadMarkdownEditorPreferencesAtom = atom(null, (get, set): Promise<void> => {
  return enqueuePreferencesOperation(get, set, async () => {
    try {
      await readConfirmedPreferences(get, set)
      set(markdownEditorPreferencesErrorAtom, null)
    } catch (error) {
      set(markdownEditorPreferencesErrorAtom, preferencesErrorMessage(error, 'Markdown 编辑器偏好加载失败，请重试。'))
      throw error
    }
  })
})

export const updateMarkdownEditorPreferencesAtom = atom(
  null,
  (get, set, updates: MarkdownEditorPreferencesUpdate): Promise<void> => {
    const revision = get(preferencesRevisionAtom) + 1
    const patch: MarkdownEditorPreferencesUpdate = {
      ...updates,
      ...(updates.shortcuts ? { shortcuts: { ...updates.shortcuts } } : {}),
    }
    set(preferencesRevisionAtom, revision)
    set(preferencesIntentsAtom, [...get(preferencesIntentsAtom), { revision, updates: patch }])
    refreshVisiblePreferences(get, set)
    set(markdownEditorPreferencesErrorAtom, null)
    set(pendingSavesAtom, get(pendingSavesAtom) + 1)

    return enqueuePreferencesOperation(get, set, async () => {
      try {
        // 首次直接打开偏好设置也必须先读取底稿，不能用默认值覆盖磁盘偏好。
        if (!get(preferencesInitializedAtom)) await readConfirmedPreferences(get, set)
        const desired = replayPreferencesIntents(
          get(confirmedPreferencesAtom),
          get(preferencesIntentsAtom).filter(intent => intent.revision <= revision),
        )
        // 每次发送完整的用户意图，前一项失败也不会丢掉后续请求中的更改。
        const settings = await window.electronAPI.updateSettings({ markdownEditor: desired })
        const confirmed = normalizeMarkdownEditorPreferences(settings.markdownEditor)
        set(confirmedPreferencesAtom, confirmed)
        set(preferencesIntentsAtom, get(preferencesIntentsAtom).filter(intent => intent.revision > revision))
        refreshVisiblePreferences(get, set)
        set(markdownEditorPreferencesErrorAtom, null)
      } catch (error) {
        if (get(preferencesRevisionAtom) === revision) {
          set(preferencesIntentsAtom, [])
          set(markdownEditorPreferencesAtom, get(confirmedPreferencesAtom))
        }
        set(markdownEditorPreferencesErrorAtom, preferencesErrorMessage(error, 'Markdown 编辑器偏好保存失败，请重试。'))
        throw error
      } finally {
        set(pendingSavesAtom, get(pendingSavesAtom) - 1)
      }
    })
  },
)
