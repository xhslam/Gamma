import { describe, expect, test } from 'bun:test'
interface PerFileOptions { entitlements?: string; hardenedRuntime?: boolean }
const { computerOptionsForFile } = require('./sign-mac-app.cjs') as {
  computerOptionsForFile(app: string, original: (file: string) => PerFileOptions): (file: string) => PerFileOptions
}
describe('Given 嵌套Computer helper签名策略（不执行codesign）', () => {
  const app = '/local/build/Gamma.app'
  const own = `${app}/Contents/Helpers/Gamma Computer Use Helper.app`
  const options = computerOptionsForFile(app, () => ({ entitlements: 'electron-wide.plist' }))
  test('When helper bundle和可执行文件 Then 使用其独立最小权限', () => {
    expect(options(own).entitlements).toBe(`${own}/Contents/Resources/entitlements.plist`)
    expect(options(`${own}/Contents/MacOS/Gamma Computer Use Helper`).hardenedRuntime).toBe(true)
  })
  test('When 主程序和其他Electron helper Then 不改变既有规则', () => {
    expect(options(app).entitlements).toBe('electron-wide.plist')
    expect(options(`${own}.other/Contents/MacOS/x`).entitlements).toBe('electron-wide.plist')
  })
})
