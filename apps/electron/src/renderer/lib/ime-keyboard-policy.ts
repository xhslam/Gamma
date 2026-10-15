/** 原生事件、Safari 的 229 回退和编辑器 composition 状态任一成立，都应让 IME 先处理。 */
export interface ImeKeyboardEvent {
  isComposing?: boolean
  keyCode?: number
}

export function isImeKeyboardEvent(event: ImeKeyboardEvent, composing = false): boolean {
  return composing || event.isComposing === true || event.keyCode === 229
}
