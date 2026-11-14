import { atom } from 'jotai'
import type { ThemeStyle } from '../../types'

export interface CircleRevealState {
  active: boolean
  originX: number
  originY: number
  targetStyle: ThemeStyle
}

/** 控制 /theme 浮动 Dock 的打开状态 */
export const themePickerOpenAtom = atom<boolean>(false)

/** 键盘预览中的临时主题（尚未 Enter 确认） */
export const themePreviewStyleAtom = atom<ThemeStyle | null>(null)

/** 圆形揭幕过渡状态 */
export const circleRevealStateAtom = atom<CircleRevealState | null>(null)
