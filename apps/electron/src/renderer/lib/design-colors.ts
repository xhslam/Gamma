/** Canvas / xterm 等不接受 CSS var 的渲染器从这里读取令牌，不复制调色板。 */
export type DesignColorRole = 'background' | 'panel' | 'inset' | 'text' | 'secondary' | 'tertiary' | 'accent' | 'border' | 'overlay' | 'inverse-text'
export interface DesignColorReader { (role: DesignColorRole): string }

export const readDesignColor: DesignColorReader = (role) => {
  const color = getComputedStyle(document.documentElement).getPropertyValue(`--color-${role}`).trim()
  if (!color) throw new Error(`缺少设计颜色令牌：--color-${role}`)
  return color
}
