import { atom } from 'jotai'
import type { SettingsTab } from '../../types/settings'
export type { SettingsTab } from '../../types/settings'

/** 记住当前设置分类，下次打开时继续。 */
export const settingsTabAtom = atom<SettingsTab>('channels')

interface SettingsWindowRequest {
  tab: SettingsTab
  navigate: boolean
}

export const settingsWindowRequestAtom = atom<SettingsWindowRequest | null>(null)

/** 没有指定分类的请求只唤回已打开的窗口。 */
export const settingsOpenAtom = atom(
  get => get(settingsWindowRequestAtom) !== null,
  (get, set, open: boolean) => {
    set(settingsWindowRequestAtom, open ? { tab: get(settingsTabAtom), navigate: false } : null)
  },
)

/** 深链接即使在设置已打开时，也会请求切换分类。 */
export const openSettingsToTabAtom = atom(null, (_get, set, tab: SettingsTab) => {
  set(settingsTabAtom, tab)
  set(settingsWindowRequestAtom, { tab, navigate: true })
})

/** 仅在独立设置窗口内使用，拦截未保存的渠道表单导航。 */
export const channelFormDirtyAtom = atom(false)
