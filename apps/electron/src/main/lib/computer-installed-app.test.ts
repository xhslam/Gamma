import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInstalledComputerApp } from './computer-installed-app'

const temporary: string[] = []
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gamma-installed-app-'))
  temporary.push(root)
  const metadata = new Map<string, unknown>()
  const reads: string[] = []
  function app(name: string, data: unknown, parent = root) {
    const contents = join(parent, `${name}.app`, 'Contents')
    mkdirSync(contents, { recursive: true })
    const plist = join(contents, 'Info.plist')
    writeFileSync(plist, '{}')
    metadata.set(plist, data)
    return join(parent, `${name}.app`)
  }
  const options = { roots: [root], reader: async (path: string) => { reads.push(path); return metadata.get(path) } }
  return { root, app, reads, options }
}
const safari = { CFBundleIdentifier: 'com.apple.Safari', CFBundleName: 'Safari', CFBundleDisplayName: 'Safari Browser' }

describe('Given 只读已安装应用身份解析', () => {
  test('When 应用未运行 Then 可按 bundle ID、bundle 名、显示名和去扩展文件名解析', async () => {
    const f = fixture()
    f.app('Safari Technology', safari)
    for (const identifier of ['com.apple.Safari', 'Safari', 'Safari Browser', 'Safari Technology', 'Safari Technology.app', '  SAFARI  ']) {
      expect(await resolveInstalledComputerApp(identifier, 'darwin', f.options)).toEqual({ appName: 'Safari Browser', bundleId: 'com.apple.Safari' })
    }
  })
  test('When 显式路径恰为受限目录内已发现的 bundle Then 允许；任意外部路径不读取', async () => {
    const f = fixture()
    const path = f.app('Safari', safari)
    expect(await resolveInstalledComputerApp(path, 'darwin', f.options)).toEqual({ appName: 'Safari Browser', bundleId: 'com.apple.Safari' })
    f.reads.length = 0
    expect(await resolveInstalledComputerApp('/private/secret/Safari.app', 'darwin', f.options)).toBeUndefined()
    expect(f.reads).toEqual([])
  })
  test('When 两个不同 bundle 共用别名 Then 拒绝；明确 bundle ID 仍唯一解析', async () => {
    const f = fixture()
    f.app('One', { CFBundleIdentifier: 'org.test.one', CFBundleName: 'Editor' })
    f.app('Two', { CFBundleIdentifier: 'org.test.two', CFBundleName: 'Editor' })
    expect(await resolveInstalledComputerApp('Editor', 'darwin', f.options)).toBeUndefined()
    expect(await resolveInstalledComputerApp('org.test.one', 'darwin', f.options)).toEqual({ appName: 'Editor', bundleId: 'org.test.one' })
  })
  test('When macOS 系统 bundle ID 包含下划线 Then 保留真实标识而非误拒绝', async () => {
    const f = fixture()
    f.app('Image Capture', { CFBundleIdentifier: 'com.apple.Image_Capture', CFBundleName: 'Image Capture' })
    expect(await resolveInstalledComputerApp('com.apple.Image_Capture', 'darwin', f.options)).toEqual({ appName: 'Image Capture', bundleId: 'com.apple.Image_Capture' })
  })
  test('When 多个安装副本具有同一完整身份 Then 不误判为多个 bundle', async () => {
    const f = fixture()
    f.app('First', safari)
    f.app('Second', safari)
    expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toEqual({ appName: 'Safari Browser', bundleId: 'com.apple.Safari' })
  })
  test('When 身份不完整、plist 无效或 reader 抛错 Then 失败关闭', async () => {
    for (const data of [{ CFBundleName: 'Safari' }, { CFBundleIdentifier: 'com.apple.Safari' }, { ...safari, CFBundleIdentifier: '../invalid' }, null, []]) {
      const f = fixture()
      f.app('Safari', data)
      expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toBeUndefined()
    }
    const f = fixture()
    f.app('Safari', safari)
    expect(await resolveInstalledComputerApp('Safari', 'darwin', { ...f.options, reader: async () => { throw new Error('invalid plist') } })).toBeUndefined()
  })
  test('When 非 mac、未知或本地化别名、非法输入 Then 不猜测身份', async () => {
    const f = fixture()
    f.app('Safari', safari)
    for (const platform of ['linux', 'win32'] as const) expect(await resolveInstalledComputerApp('Safari', platform, f.options)).toBeUndefined()
    expect(f.reads).toEqual([])
    for (const identifier of ['', ' ', 'Safari\0', 'x'.repeat(1025), '备忘录', 'Unknown']) {
      expect(await resolveInstalledComputerApp(identifier, 'darwin', f.options)).toBeUndefined()
    }
  })
  test('When 应用位于 Utilities 子目录或独立 Cryptex 根 Then 可解析且不深入 app 内部', async () => {
    const f = fixture()
    f.app('Safari', safari, join(f.root, 'Utilities'))
    expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toMatchObject({ bundleId: 'com.apple.Safari' })
    expect(f.reads).toHaveLength(1)
    const cryptex = fixture()
    cryptex.app('Safari', safari)
    expect(await resolveInstalledComputerApp('Safari', 'darwin', { ...cryptex.options, roots: [join(f.root, 'missing'), cryptex.root] })).toMatchObject({ bundleId: 'com.apple.Safari' })
  })
  test('When Applications 留有非 app 备份目录 Then 不枚举备份包的 Contents 载荷', async () => {
    const f = fixture()
    f.app('Safari', safari)
    f.app('Hidden', { CFBundleIdentifier: 'org.test.backup', CFBundleName: 'Safari' }, join(f.root, 'Old.app.backup', 'Contents', 'Resources'))
    expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toMatchObject({ bundleId: 'com.apple.Safari' })
    expect(f.reads).toHaveLength(1)
  })
  test('When bundle、Contents 或 plist 是符号链接 Then 不跟随到目录外', async () => {
    for (const part of ['bundle', 'contents', 'plist']) {
      const f = fixture()
      const outside = fixture()
      const external = outside.app('Safari', safari)
      if (part === 'bundle') symlinkSync(external, join(f.root, 'Safari.app'))
      else {
        const bundle = join(f.root, 'Safari.app')
        mkdirSync(bundle)
        if (part === 'contents') symlinkSync(join(external, 'Contents'), join(bundle, 'Contents'))
        else {
          mkdirSync(join(bundle, 'Contents'))
          symlinkSync(join(external, 'Contents', 'Info.plist'), join(bundle, 'Contents', 'Info.plist'))
        }
      }
      expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toBeUndefined()
      expect(f.reads).toEqual([])
    }
  })
  test('When 扫描超过深度、条目或读取时限 Then 不返回可能遗漏歧义的身份', async () => {
    const f = fixture()
    f.app('Safari', safari, join(f.root, 'deep', 'nested', 'again'))
    f.app('Visible', safari)
    expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toBeUndefined()
    const g = fixture()
    g.app('Safari', safari)
    g.app('Other', { CFBundleIdentifier: 'org.test.other', CFBundleName: 'Other' })
    expect(await resolveInstalledComputerApp('Safari', 'darwin', { ...g.options, maxEntries: 0 })).toBeUndefined()
    expect(await resolveInstalledComputerApp('Safari', 'darwin', { ...g.options, maxEntries: 1 })).toBeUndefined()
    expect(await resolveInstalledComputerApp('Safari', 'darwin', { ...g.options, timeoutMs: 10, reader: async () => new Promise<unknown>(() => {}) })).toBeUndefined()
  })
  test('When plist 超出大小上限 Then 不交给读取器', async () => {
    const f = fixture()
    const bundle = f.app('Safari', safari)
    truncateSync(join(bundle, 'Contents', 'Info.plist'), 1_048_577)
    expect(await resolveInstalledComputerApp('Safari', 'darwin', f.options)).toBeUndefined()
    expect(f.reads).toEqual([])
  })
  test('When 使用真实系统 plutil 解析含日期的 XML plist Then 返回安装身份', async () => {
    if (process.platform !== 'darwin') return
    const f = fixture()
    const bundle = f.app('Safari', safari)
    writeFileSync(join(bundle, 'Contents', 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.Safari</string><key>CFBundleName</key><string>Safari</string><key>BuildDate</key><date>2026-01-01T00:00:00Z</date></dict></plist>')
    expect(await resolveInstalledComputerApp('Safari', 'darwin', { roots: [f.root] })).toEqual({ appName: 'Safari', bundleId: 'com.apple.Safari' })
  })
})
