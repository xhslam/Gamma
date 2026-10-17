import { describe, expect, test } from 'bun:test'
import { assertComputerSender } from './computer-ipc-policy'
const trusted = { matchesMainWindow: true, matchesTopFrame: true, visible: true, focused: true, requiresFocus: true }
describe('Given 可信桌面IPC', () => {
  test('When 主窗口顶层可见且聚焦 Then 可提交本地授权', () => expect(() => assertComputerSender(trusted)).not.toThrow())
  test('When iframe/其他窗口/隐藏或不聚焦 Then 不能授予权限', () => {
    for (const key of ['matchesMainWindow', 'matchesTopFrame', 'visible', 'focused'] as const) expect(() => assertComputerSender({ ...trusted, [key]: false })).toThrow()
  })
  test('When 窗口隐藏 Then 可信停止仍可调用', () => expect(() => assertComputerSender({ ...trusted, visible: false, focused: false, requiresFocus: false })).not.toThrow())
})
