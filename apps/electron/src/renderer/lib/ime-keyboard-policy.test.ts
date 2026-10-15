import { describe, expect, test } from 'bun:test'
import { isImeKeyboardEvent } from './ime-keyboard-policy'

describe('Given 输入法候选确认键', () => {
  test('When ref、原生状态或 229 任一成立 Then 不运行自定义快捷键', () => {
    expect(isImeKeyboardEvent({}, true)).toBe(true)
    expect(isImeKeyboardEvent({ isComposing: true })).toBe(true)
    expect(isImeKeyboardEvent({ keyCode: 229 })).toBe(true)
  })
  test('When compositionend 先发生且 Enter 仍是 229 Then 不发送，后续正常 Enter 可发送', () => {
    expect(isImeKeyboardEvent({ isComposing: false, keyCode: 229 }, false)).toBe(true)
    expect(isImeKeyboardEvent({ isComposing: false, keyCode: 13 }, false)).toBe(false)
  })
})
