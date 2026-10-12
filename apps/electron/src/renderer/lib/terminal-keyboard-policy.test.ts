import { describe, expect, test } from 'bun:test'
import { shouldPreserveTerminalControlKey } from './terminal-keyboard-policy'

const control = { inTerminal: true, key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }

describe('终端控制键归属', () => {
  test('Given 焦点在终端 When 输入 shell 控制键 Then 应用快捷键不抢走输入', () => {
    for (const key of ['c', 'd', 'l', 'k', 'b', 's', 'q']) expect(shouldPreserveTerminalControlKey({ ...control, key })).toBe(true)
  })
  test('Given 非终端或应用组合键 When 分发快捷键 Then 保留原应用快捷键行为', () => {
    expect(shouldPreserveTerminalControlKey({ ...control, inTerminal: false })).toBe(false)
    expect(shouldPreserveTerminalControlKey({ ...control, key: 'Tab' })).toBe(false)
    expect(shouldPreserveTerminalControlKey({ ...control, shiftKey: true })).toBe(false)
    expect(shouldPreserveTerminalControlKey({ ...control, metaKey: true })).toBe(false)
    expect(shouldPreserveTerminalControlKey({ ...control, altKey: true })).toBe(false)
    expect(shouldPreserveTerminalControlKey({ ...control, ctrlKey: false, key: 'Enter' })).toBe(false)
  })
})
