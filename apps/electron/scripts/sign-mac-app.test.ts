import { describe, expect, test } from 'bun:test'
interface PerFileOptions { entitlements?: string; hardenedRuntime?: boolean }
interface SigningDefaults extends PerFileOptions { entitlementsInherit?: string }
const { computerOptionsForFile } = require('./sign-mac-app.cjs') as {
  computerOptionsForFile(app: string, original?: (file: string) => PerFileOptions, defaults?: SigningDefaults): (file: string) => PerFileOptions
}
describe('Given 嵌套Computer helper签名策略（不执行codesign）', () => {
  const app = '/local/build/Gamma.app'
  const own = `${app}/Contents/Helpers/Gamma Computer Use Helper.app`
  const options = computerOptionsForFile(app, () => ({ entitlements: 'electron-wide.plist' }))
  test('When helper bundle和可执行文件 Then 使用其独立最小权限', () => {
    expect(options(own).entitlements).toBe(`${own}/Contents/Resources/entitlements.plist`)
    expect(options(`${own}/Contents/MacOS/Gamma Computer Use Helper`).hardenedRuntime).toBe(true)
  })
  test('When 未提供per-file回调 Then 主进程继承项目权限，普通子进程使用inherit权限', () => {
    const fallback = computerOptionsForFile(app, undefined, { entitlements: 'main.plist', entitlementsInherit: 'child.plist', hardenedRuntime: true })
    expect(fallback(app)).toEqual({ entitlements: 'main.plist', hardenedRuntime: true })
    expect(fallback(`${app}/Contents/Frameworks/Gamma Helper.app`)).toEqual({ entitlements: 'child.plist', hardenedRuntime: true })
    expect(fallback(own).entitlements).toBe(`${own}/Contents/Resources/entitlements.plist`)
  })
  test('When 仅提供主进程权限 Then 普通子进程也继承它，不回退osx-sign默认权限', () => {
    const fallback = computerOptionsForFile(app, undefined, { entitlements: 'project.plist' })
    expect(fallback(app).entitlements).toBe('project.plist')
    expect(fallback(`${app}/Contents/Frameworks/Gamma Helper.app`).entitlements).toBe('project.plist')
  })
  test('When 主程序和其他Electron helper Then 不改变既有规则', () => {
    expect(options(app).entitlements).toBe('electron-wide.plist')
    expect(options(`${own}.other/Contents/MacOS/x`).entitlements).toBe('electron-wide.plist')
  })
})
