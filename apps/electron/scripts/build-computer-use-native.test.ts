import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildComputerUseNative, computerUseBuildPlan } from './build-computer-use-native'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
describe('Given Gamma主应用内Computer Use CLI构建计划', () => {
  test('When非macOS Then不构建或运行helper', () => {
    expect(computerUseBuildPlan({ appDir, platform: 'linux', hostArch: 'x64' })).toBeNull()
  })
  test('When指定host/交叉架构 Then使用macOS14 deployment target与裸CLI，不生成独立应用', () => {
    const arm = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: 'arm64' })
    const intel = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: 'arm64', targetArch: 'x64' })
    expect(arm?.target).toBe('arm64-apple-macosx14.0')
    expect(intel?.target).toBe('x86_64-apple-macosx14.0')
    expect(arm?.executable).toEndWith('/resources/computer-use/gamma-computer-use-helper')
    expect(arm?.entitlements).toEndWith('/resources/computer-use/entitlements.plist')
    expect(() => computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: 'riscv64' })).toThrow()
  })
  test('When检查构建脚本 Then无签名、启动、安装或外部下载命令', () => {
    const source = readFileSync(resolve(appDir, 'scripts/build-computer-use-native.ts'), 'utf8')
    expect(source).not.toMatch(/execFileSync\(['"](?:codesign|open|curl|npx|npm|osascript)['"]/)
    expect(source).not.toContain('Electron.app')
    expect(source).toContain("'-warnings-as-errors'")
    expect(source).not.toContain("copyFileSync(resolve(plan.sourceDir, 'Info.plist')")
  })
  test('When 检查打包契约 Then 裸CLI与最小权限进入主App Resources，不交付独立APPL bundle', () => {
    const config = readFileSync(resolve(appDir, 'electron-builder.yml'), 'utf8')
    expect(config).toContain('from: resources/computer-use\n      to: computer-use\n      filter:\n        - gamma-computer-use-helper\n        - entitlements.plist')
    expect(config).toContain('- Contents/Resources/computer-use/gamma-computer-use-helper')
    expect(config).not.toContain('Helpers/Gamma Computer Use Helper.app')
    expect(config).not.toContain('from: resources/computer-use/Gamma Computer Use Helper.app')
  })
})
const macTest = process.platform === 'darwin' ? test : test.skip
macTest('Given 含旧bundle与Info.plist的构建目录 When 编译新CLI Then 仅生成可执行文件和最小权限且不执行授权入口', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'gamma-computer-bare-build-'))
  try {
    const source = resolve(directory, 'native/computer-use')
    const resources = resolve(directory, 'resources/computer-use')
    const marker = resolve(directory, 'entry-was-started')
    mkdirSync(source, { recursive: true })
    mkdirSync(resolve(resources, 'Gamma Computer Use Helper.app/Contents'), { recursive: true })
    writeFileSync(resolve(source, 'main.swift'), `import Foundation\n_ = FileManager.default.createFile(atPath: ${JSON.stringify(marker)}, contents: Data())\n`)
    writeFileSync(resolve(source, 'Info.plist'), '<plist><dict><key>CFBundlePackageType</key><string>APPL</string></dict></plist>')
    const minimumEntitlements = '<?xml version="1.0"?><plist version="1.0"><dict/></plist>'
    writeFileSync(resolve(source, 'entitlements.plist'), minimumEntitlements)
    const output = buildComputerUseNative({ appDir: directory, platform: 'darwin', hostArch: process.arch })!
    expect(output).toBe(resolve(resources, 'gamma-computer-use-helper'))
    expect(statSync(output).isFile()).toBe(true)
    expect(statSync(output).mode & 0o777).toBe(0o755)
    expect(readdirSync(resources).sort()).toEqual(['entitlements.plist', 'gamma-computer-use-helper'])
    expect(readFileSync(resolve(resources, 'entitlements.plist'), 'utf8')).toBe(minimumEntitlements)
    expect(existsSync(marker)).toBe(false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 150_000)

macTest('Given纯离线入口 When编译并运行--self-test Then安全锁存/重放/失效/坐标/UTF16/协议边界全部通过且不启动桌面', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'gamma-computer-use-offline-'))
  try {
    const output = resolve(directory, 'offline-test')
    const source = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: process.arch })!
    // 编译整套生产源码，但只执行--self-test分支；禁止运行正常入口或权限API。
    // 与生产构建使用相同源码集合，新增 worker 不应被离线编译遗漏。
    const names = readdirSync(source.sourceDir).filter(name => name.endsWith('.swift')).sort()
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-warnings-as-errors', '-target', source.target, ...names.map((name) => resolve(source.sourceDir, name)), '-o', output], { timeout: 120_000 })
    const result = JSON.parse(execFileSync(output, ['--self-test'], { encoding: 'utf8', timeout: 15_000 })) as { selfTest: boolean; passed: number; desktopAPIsInvoked: boolean }
    expect(result.selfTest).toBe(true)
    expect(result.desktopAPIsInvoked).toBe(false)
    expect(result.passed).toBeGreaterThanOrEqual(30)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 150_000)

macTest('Given 生产Engine watchdog When 列窗及prepare超过100ms Then 不误停且停止入口丢失仍立即暂停', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'gamma-computer-engine-'))
  try {
    const plan = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: process.arch })!
    // 编译原版 Engine/安全门/协议；只替换 UI 与入口，桌面读取和绑定使用无副作用的延迟 fixture。
    writeFileSync(resolve(directory, 'NativeUI.swift'), `
import Foundation
final class NativeUI {
  var onStop: (String) -> Void = { _ in }
  var hasVisibleStop = false
  func setStatus(_ text: String) { hasVisibleStop = true }
  func hideStop() { hasVisibleStop = false }
  func cancelAll() { hideStop() }
}
`)
    writeFileSync(resolve(directory, 'main.swift'), `
import Foundation
func pump(_ seconds: TimeInterval) { RunLoop.main.run(until: Date().addingTimeInterval(seconds)) }
func require(_ condition: Bool) { if !condition { exit(2) } }
func scenario(_ method: String, disappear: Bool) throws {
  let engine = Engine(readWindows: { Thread.sleep(forTimeInterval: 0.25); return [] }, prepareAction: { _,_,_ in Thread.sleep(forTimeInterval: 0.25); throw NativeFailure("stale-element-ref", "fixture") })
  engine.start()
  let token = try engine.gate.begin(LeaseParams(leaseId: "fixture", epoch: 1, deadline: Date().timeIntervalSince1970 * 1000 + 10000))
  try engine.gate.finishSelection(nil, token: token); engine.gate.setListenerHealthy(true)
  try engine.gate.save(Snapshot(id: "obs", epoch: 1, fence: token, created: ProcessInfo.processInfo.systemUptime, width: 10, height: 10, axDigest: ""))
  let request: [String: Any] = ["id": "test-" + method + "-" + String(disappear), "method": method, "params": ["leaseId": "fixture", "epoch": 1, "actionId": "a", "action": ["kind": "wait", "observationId": "obs"]]]
  engine.handle(try JSONSerialization.data(withJSONObject: request))
  require(engine.ui.hasVisibleStop)
  pump(0.12)
  require(engine.gate.isActive)
  if disappear { engine.ui.hideStop() }
  pump(0.24)
  require(engine.gate.isActive != disappear)
  require(!engine.ui.hasVisibleStop)
  engine.stop("fixture结束"); pump(0.02)
}
try scenario("listWindows", disappear: false)
try scenario("prepare", disappear: false)
try scenario("listWindows", disappear: true)
print("ENGINE_WATCHDOG_PASSED")
`)
    const names = readdirSync(plan.sourceDir).filter(name => name.endsWith('.swift') && !['NativeUI.swift', 'main.swift'].includes(name)).sort()
    const output = resolve(directory, 'engine-test')
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-warnings-as-errors', '-target', plan.target, ...names.map(name => resolve(plan.sourceDir, name)), resolve(directory, 'NativeUI.swift'), resolve(directory, 'main.swift'), '-o', output], { timeout: 120_000 })
    const result = execFileSync(output, [], { encoding: 'utf8', timeout: 10_000 })
    expect(result).toContain('ENGINE_WATCHDOG_PASSED')
    expect(result).toContain('stale-element-ref')
    expect(result).toContain('test-listWindows-false')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 150_000)
