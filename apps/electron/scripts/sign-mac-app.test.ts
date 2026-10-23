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
      expect(signed.optionsForFile?.(`${app}/Contents/Helpers/Gamma Computer Use Helper.app`)).toMatchObject({
        entitlements: `${app}/Contents/Helpers/Gamma Computer Use Helper.app/Contents/Resources/entitlements.plist`,
        hardenedRuntime: true,
      })
    }
  })
  test('When 使用正式证书 Then 保留证书、校验、时间戳和既有逐文件配置', () => {
    const signed = signingOptions({ app, identity: 'Developer ID Application: Gamma', identityValidation: true, optionsForFile: () => ({ entitlements: 'release.plist', timestamp: 'https://timestamp.example' }) })
    expect(signed.identity).toBe('Developer ID Application: Gamma')
    expect(signed.identityValidation).toBe(true)
    expect(signed.optionsForFile?.(app)).toEqual({ entitlements: 'release.plist', timestamp: 'https://timestamp.example' })
  })
  test('When App Store 构建缺少证书 Then 明确失败而不降级为临时签名', () => {
    expect(() => signingOptions({ app, platform: 'mas' })).toThrow('需要有效的签名证书')
  })
})
