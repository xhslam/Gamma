import { describe, expect, test } from 'bun:test'
interface PerFileOptions { entitlements?: string; hardenedRuntime?: boolean; timestamp?: string }
interface SigningDefaults extends PerFileOptions { entitlementsInherit?: string }
interface SigningOptions extends SigningDefaults {
  app: string
  platform?: 'darwin' | 'mas'
  identity?: string
  identityValidation?: boolean
  preAutoEntitlements?: boolean
  optionsForFile?: (file: string) => PerFileOptions
}
const { computerOptionsForFile } = require('./sign-mac-app.cjs') as {
  computerOptionsForFile(app: string, original?: (file: string) => PerFileOptions, defaults?: SigningDefaults): (file: string) => PerFileOptions
}
describe('Given 主App内 agent-desktop CLI 与 helper 签名策略（不执行codesign）', () => {
  const app = '/local/build/Gamma.app'
  const executable = `${app}/Contents/Resources/agent-desktop/agent-desktop`
  const helper = `${app}/Contents/Resources/agent-desktop/agent-desktop-macos-helper`
  const options = computerOptionsForFile(app, () => ({ entitlements: 'electron-wide.plist' }))
  test('When 签名 agent-desktop CLI 与 helper Then 启用 hardenedRuntime', () => {
    expect(options(executable).hardenedRuntime).toBe(true)
    expect(options(helper).hardenedRuntime).toBe(true)
  })
  test('When 未提供per-file回调 Then 主进程继承项目权限，普通子进程使用inherit权限', () => {
    const fallback = computerOptionsForFile(app, undefined, { entitlements: 'main.plist', entitlementsInherit: 'child.plist', hardenedRuntime: true })
    expect(fallback(app)).toEqual({ entitlements: 'main.plist', hardenedRuntime: true })
    expect(fallback(`${app}/Contents/Frameworks/Gamma Helper.app`)).toEqual({ entitlements: 'child.plist', hardenedRuntime: true })
    expect(fallback(executable).hardenedRuntime).toBe(true)
    expect(fallback(helper).hardenedRuntime).toBe(true)
  })
  test('When 仅提供主进程权限 Then 普通子进程也继承它，不回退osx-sign默认权限', () => {
    const fallback = computerOptionsForFile(app, undefined, { entitlements: 'project.plist' })
    expect(fallback(app).entitlements).toBe('project.plist')
    expect(fallback(`${app}/Contents/Frameworks/Gamma Helper.app`).entitlements).toBe('project.plist')
  })
  test('When 主程序和其他Electron helper Then 不改变既有规则', () => {
    expect(options(app).entitlements).toBe('electron-wide.plist')
    expect(options(`${executable}.other`).entitlements).toBe('electron-wide.plist')
  })
})

describe('Given macOS 打包签名身份', () => {
  const { signingOptions } = require('./sign-mac-app.cjs') as { signingOptions(options: SigningOptions): SigningOptions }
  const app = '/local/build/Gamma.app'
  test('When 本机没有证书或显式临时签名 Then 完整签名应用和Helper且不查询证书或时间戳服务', () => {
    for (const identity of [undefined, 'none', '-']) {
      const signed = signingOptions({ app, platform: 'darwin', identity, entitlements: 'project.plist' })
      expect(signed.identity).toBe('-')
      expect(signed.identityValidation).toBe(false)
      expect(signed.preAutoEntitlements).toBe(false)
      expect(signed.optionsForFile?.(app)).toMatchObject({ entitlements: 'project.plist', timestamp: 'none' })
      expect(signed.optionsForFile?.(`${app}/Contents/Resources/agent-desktop/agent-desktop`)).toMatchObject({
        hardenedRuntime: true,
      })
      expect(signed.optionsForFile?.(`${app}/Contents/Resources/agent-desktop/agent-desktop-macos-helper`)).toMatchObject({
        hardenedRuntime: true,
      })
    }
  })
  test('When 使用正式证书 Then 保留证书、校验、时间戳和既有逐文件配置', () => {
    const signed = signingOptions({ app, identity: 'Developer ID Application: Gamma', identityValidation: true, optionsForFile: () => ({ entitlements: 'release.plist', timestamp: 'https://timestamp.example' }) })
    expect(signed.identity).toBe('Developer ID Application: Gamma')
    expect(signed.optionsForFile?.(app)).toMatchObject({ entitlements: 'release.plist', timestamp: 'https://timestamp.example' })
  })
})
