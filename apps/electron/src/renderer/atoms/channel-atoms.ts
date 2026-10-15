/** 公共渠道与模型选择器状态，不绑定具体会话产品。 */
import { atom } from 'jotai'
import type { Channel } from '@gamma/shared'

/** 全局渠道列表缓存（启动时加载一次，设置变更时刷新）。 */
export const channelsAtom = atom<Channel[]>([])

/** 渠道列表是否已完成首次加载。 */
export const channelsLoadedAtom = atom(false)

/** 共享模型选择器打开状态，用于错误卡片等外部入口。 */
export const modelSelectorOpenAtom = atom(false)
