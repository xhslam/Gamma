import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computerUseBuildPlan } from './build-computer-use-native'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
describe('Given独立Computer Use构建计划', () => {
  test('When非macOS Then不构建或运行helper', () => {
    expect(computerUseBuildPlan({ appDir, platform: 'linux', hostArch: 'x64' })).toBeNull()
  })
  test('When指定host/交叉架构 Then使用macOS14 deployment target与独立bundle', () => {
    const arm = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: 'arm64' })
    const intel = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: 'arm64', targetArch: 'x64' })
    expect(arm?.target).toBe('arm64-apple-macosx14.0')
    expect(intel?.target).toBe('x86_64-apple-macosx14.0')
    expect(arm?.bundle).toEndWith('/resources/computer-use/Gamma Computer Use Helper.app')
    expect(() => computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: 'riscv64' })).toThrow()
  })
  test('When检查构建脚本 Then无签名、启动、安装或外部下载命令', () => {
    const source = readFileSync(resolve(appDir, 'scripts/build-computer-use-native.ts'), 'utf8')
    expect(source).not.toMatch(/execFileSync\(['"](?:codesign|open|curl|npx|npm|osascript)['"]/)
    expect(source).not.toContain('Electron.app')
    expect(source).toContain("'-warnings-as-errors'")
  })
})
const macTest = process.platform === 'darwin' ? test : test.skip
macTest('Given纯离线入口 When编译并运行--self-test Then安全锁存/重放/失效/坐标/UTF16/协议边界全部通过且不启动桌面', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'gamma-computer-use-offline-'))
  try {
    const output = resolve(directory, 'offline-test')
    const source = computerUseBuildPlan({ appDir, platform: 'darwin', hostArch: process.arch })!
    // 编译整套生产源码，但只执行--self-test分支；禁止运行正常入口或权限API。
    const names = ['Safety.swift', 'Accessibility.swift', 'Desktop.swift', 'NativeUI.swift', 'Protocol.swift', 'Engine.swift', 'SelfTests.swift', 'main.swift']
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-warnings-as-errors', '-target', source.target, ...names.map((name) => resolve(source.sourceDir, name)), '-o', output], { timeout: 120_000 })
    const result = JSON.parse(execFileSync(output, ['--self-test'], { encoding: 'utf8', timeout: 15_000 })) as { selfTest: boolean; passed: number; desktopAPIsInvoked: boolean }
    expect(result.selfTest).toBe(true)
    expect(result.desktopAPIsInvoked).toBe(false)
    expect(result.passed).toBeGreaterThanOrEqual(30)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 150_000)
