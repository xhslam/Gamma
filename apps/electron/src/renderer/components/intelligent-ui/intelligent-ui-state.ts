import { atomWithStorage } from 'jotai/utils'
import type { BlockInteractionState } from '@gamma/genui-embed'

export interface UiStateEntry { key: string; state: BlockInteractionState }
const BLOCKED_KEY = /^(?:__proto__|constructor|prototype)$|password|secret|token|api.?key|密码|密钥|令牌/i
function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, 200).filter(([key, item]) => !BLOCKED_KEY.test(key) && typeof item === 'string').map(([key, item]) => [key.slice(0, 120), (item as string).slice(0, 4000)]))
}
function normalizeState(value: unknown): BlockInteractionState {
  if (!value || typeof value !== 'object') return {}
  const state = value as Record<string, unknown>
  const multiAnswers = state.multiAnswers && typeof state.multiAnswers === 'object' ? Object.fromEntries(Object.entries(state.multiAnswers).slice(0, 200)
    .filter(([key, values]) => !BLOCKED_KEY.test(key) && Array.isArray(values))
    .map(([key, values]) => [key, (values as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 100).map(item => item.slice(0, 4000))])) : {}
  return { fields: stringMap(state.fields), answers: stringMap(state.answers), multiAnswers, locked: state.locked === true }
}
export function normalizeUiStates(value: unknown): UiStateEntry[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    return typeof item.key === 'string' && item.key.length <= 1000 ? [{ key: item.key, state: normalizeState(item.state) }] : []
  })
}

/** JSON UI 偏好缓存；不可用或配额耗尽时仍允许本地操作，不使整块 UI 崩溃。 */
export const intelligentUiStatesAtom = atomWithStorage<UiStateEntry[]>('gamma.intelligent-ui.states.v1', [], {
  getItem(key, initial) {
    try {
      const raw = localStorage.getItem(key)
      return raw && raw.length <= 512 * 1024 ? normalizeUiStates(JSON.parse(raw)) : initial
    } catch { return initial }
  },
  setItem(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 状态保留在当前 Jotai store。 */ } },
  removeItem(key) { try { localStorage.removeItem(key) } catch { /* 无持久化存储时无需清除。 */ } },
}, { getOnInit: true })

export function mergeUiState(entries: UiStateEntry[], key: string, state: BlockInteractionState): UiStateEntry[] {
  const next = [{ key, state: normalizeState(state) }, ...normalizeUiStates(entries).filter(entry => entry.key !== key)].slice(0, 200)
  while (next.length && JSON.stringify(next).length > 512 * 1024) next.pop()
  return next
}
