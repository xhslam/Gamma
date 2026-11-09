/** 只传递已解析的外观值，绝不接受 CSS 文本、URL、脚本或任意选择器。 */
export interface DesignThemeSnapshot {
  mode: 'light' | 'dark'
  background: string
  panel: string
  inset: string
  text: string
  secondary: string
  tertiary: string
  border: string
  accent: string
  accentText: string
  danger: string
  ring: string
  fontFamily: string
  radius: number
}
