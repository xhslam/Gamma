import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BUNDLE_ID, COMPONENT_VERSION, DEFAULT_OUTPUT, assertInstallDestinationAbsent, buildComponent, installComponent, verifyComponent, verifyPinnedEngine } from './build-gamma-computer-use'

const macOS = process.platform === 'darwin'
const appRoot = resolve(import.meta.dir, '..')
const temporary = mkdtempSync(join(tmpdir(), 'gamma-computer-build-test-'))
afterAll(() => rmSync(temporary, { recursive: true, force: true }))

describe('Given gammaComputerUse 独立构建入口', () => {
  it('Then 使用独立版本和固定 bundle identity，不导入时构建或安装', () => {
    expect(COMPONENT_VERSION).toBe('1.0.0')
    expect(BUNDLE_ID).toBe('com.gamma.computeruse')
    expect(DEFAULT_OUTPUT).toBe(join(appRoot, 'out/gamma-computer-use/gammaComputerUse.app'))
  })
  it('When 请求旧开发 Electron 放行 Then CLI 拒绝且身份规则只允许已安装 Gamma', () => {
    const result = spawnSync(process.execPath, [join(import.meta.dir, 'build-gamma-computer-use.ts'), '--development'], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    const identity = readFileSync(join(appRoot, 'native/gamma-computer-use/Identity.swift'), 'utf8')
    expect(identity).toContain('/Applications/Gamma.app/Contents/MacOS/Gamma')
    expect(identity).not.toContain('GammaDevelopmentParent')
    expect(identity).not.toContain('Electron.app')
  })
  it('When 校验固定引擎 Then 许可证和两个引擎文件摘要均匹配', () => {
    expect(verifyPinnedEngine(join(appRoot, 'resources/agent-desktop')).version).toBe('1.0.2')
  })
  it('When 任一引擎字节被修改 Then 构建前拒绝', () => {
    const copied = join(temporary, 'engine')
    cpSync(join(appRoot, 'resources/agent-desktop'), copied, { recursive: true })
    writeFileSync(join(copied, 'LICENSE'), '篡改')
    expect(() => verifyPinnedEngine(copied)).toThrow('完整性不匹配')
  })
  it('When 已有同名目录或断链 Then 绝不覆盖，原始内容保持不变', () => {
    const target = join(temporary, 'existing.app')
    mkdirSync(target)
    writeFileSync(join(target, 'user-file'), '保留')
    expect(() => assertInstallDestinationAbsent(target)).toThrow('绝不覆盖')
    expect(readFileSync(join(target, 'user-file'), 'utf8')).toBe('保留')
    const link = join(temporary, 'dangling.app')
    symlinkSync('/missing-gamma-component', link)
    expect(() => assertInstallDestinationAbsent(link)).toThrow('绝不覆盖')
  })
  it('When 安装目标不是固定路径 Then 无写入并拒绝', () => {
    expect(() => installComponent('/missing', join(temporary, 'bad.app'))).toThrow('安装目标固定')
    expect(existsSync(join(temporary, 'bad.app'))).toBe(false)
  })
  it('When 构建输出指向 Applications Then 拒绝', () => {
    if (macOS) expect(() => buildComponent({ output: '/Applications/gammaComputerUse.app' })).toThrow('构建产物必须')
  })
})

// 原生测试单独入口，不把 fixture 或身份绕过编入交付组件。
;(macOS ? describe : describe.skip)('Given 原生执行器与目录边界 BDD', () => {
  const executable = join(temporary, 'native-behaviors')
  beforeAll(() => {
    const native = join(appRoot, 'native/gamma-computer-use')
    execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-parse-as-library', ...['Protocol.swift', 'Identity.swift', 'Executor.swift', 'BehaviorTests.swift'].map(file => join(native, file)), '-o', executable], { stdio: 'pipe' })
  }, 60_000)
  it('Then 正常路径、真实后代取消、断连、输出上限及恶意参数均通过', () => {
    const stdout = execFileSync(executable, [join(appRoot, 'resources/agent-desktop/agent-desktop')], { encoding: 'utf8', timeout: 45_000 })
    const scenarios = JSON.parse(stdout) as string[]
    expect(scenarios.length).toBeGreaterThanOrEqual(16)
    expect(scenarios.some(text => text.includes('真实引擎和后代均已停止'))).toBe(true)
    expect(scenarios.some(text => text.includes('输出超过24MiB'))).toBe(true)
  }, 50_000)
  it('When 已有构建产物 Then 原生签名和 identity 可独立校验', () => {
    if (!existsSync(DEFAULT_OUTPUT)) return
    verifyComponent(DEFAULT_OUTPUT)
    const output = spawnSync(join(DEFAULT_OUTPUT, 'Contents/MacOS/gammaComputerUse'), ['--not-a-command'], { encoding: 'utf8' })
    expect(output.status).toBe(64)
    expect(output.stderr).toContain('用法')
    const plist = readFileSync(join(DEFAULT_OUTPUT, 'Contents/Info.plist'), 'utf8')
    expect(plist).toContain('<key>LSUIElement</key><true/>')
    expect(plist).toContain(BUNDLE_ID)
  })
})
