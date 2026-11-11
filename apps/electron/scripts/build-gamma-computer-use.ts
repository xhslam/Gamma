#!/usr/bin/env bun
/** 独立组件：只构建专用产物，不参与 Gamma 日常签名或安装。 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const COMPONENT_VERSION = '1.0.0'
export const BUNDLE_ID = 'com.gamma.computeruse'
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_OUTPUT = join(appRoot, 'out/gamma-computer-use/gammaComputerUse.app')
export const INSTALL_TARGET = '/Applications/gammaComputerUse.app'
interface SourceManifest { version: string; files: Record<string, string> }
export interface BuildOptions { output?: string }

function command(executable: string, args: string[]): string {
  return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
export function verifyPinnedEngine(source: string): SourceManifest {
  const manifest = JSON.parse(readFileSync(join(source, '.source-build.json'), 'utf8')) as SourceManifest
  if (manifest.version !== '1.0.2') throw new Error('不支持的固定引擎版本')
  for (const file of ['agent-desktop', 'agent-desktop-macos-helper', 'LICENSE', 'NOTICES.md']) {
    const path = join(source, file)
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`引擎文件必须为真实文件：${file}`)
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (actual !== manifest.files[file]) throw new Error(`固定引擎完整性不匹配：${file}`)
  }
  return manifest
}
export function verifyComponent(path: string): void {
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('组件必须为真实 app 目录')
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', path])
  const info = join(path, 'Contents/Info.plist')
  const identifier = command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', info])
  const version = command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', info])
  if (identifier !== BUNDLE_ID || version !== COMPONENT_VERSION) throw new Error('组件身份或版本不匹配')
  const binary = join(path, 'Contents/MacOS/gammaComputerUse')
  if (!lstatSync(binary).isFile() || lstatSync(binary).isSymbolicLink()) throw new Error('组件 executable 无效')
}

export function buildComponent(options: BuildOptions = {}): string {
  if (process.platform !== 'darwin') throw new Error('仅支持 macOS')
  const output = resolve(options.output ?? DEFAULT_OUTPUT)
  if (!output.startsWith(join(appRoot, 'out') + '/')) throw new Error('构建产物必须位于 apps/electron/out 内')
  const source = join(appRoot, 'resources/agent-desktop')
  verifyPinnedEngine(source)
  mkdirSync(dirname(output), { recursive: true })
  const work = mkdtempSync(join(dirname(output), '.build-'))
  const staged = join(work, 'gammaComputerUse.app')
  try {
    mkdirSync(join(staged, 'Contents/MacOS'), { recursive: true })
    mkdirSync(join(staged, 'Contents/Resources'), { recursive: true })
    cpSync(source, join(staged, 'Contents/Resources/agent-desktop'), { recursive: true })
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleName</key><string>gammaComputerUse</string>
<key>CFBundleDisplayName</key><string>gammaComputerUse</string>
<key>CFBundleExecutable</key><string>gammaComputerUse</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${COMPONENT_VERSION}</string>
<key>CFBundleVersion</key><string>${COMPONENT_VERSION}</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppleEventsUsageDescription</key><string>按用户明确指令操作已授权的应用。</string>
</dict></plist>\n`
    // 构建临时产物不是用户持久化配置；整个已校验 app 随后才进入输出目录。
    writeFileSync(join(staged, 'Contents/Info.plist'), plist)
    const native = join(appRoot, 'native/gamma-computer-use')
    command('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`, ...['Protocol.swift', 'Identity.swift', 'Executor.swift', 'Service.swift', 'main.swift'].map(file => join(native, file)), '-o', join(staged, 'Contents/MacOS/gammaComputerUse')])
    for (const file of ['agent-desktop', 'agent-desktop-macos-helper']) {
      const path = join(staged, 'Contents/Resources/agent-desktop', file)
      chmodSync(path, 0o755)
      command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', path])
    }
    command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', staged])
    verifyComponent(staged)
    // 只清理专用构建产物，绝不访问 /Applications。
    if (existsSync(output)) rmSync(output, { recursive: true })
    renameSync(staged, output)
    return output
  } finally { rmSync(work, { recursive: true, force: true }) }
}

export function assertInstallDestinationAbsent(target: string): void {
  // lstat 可识别 dangling symlink；不允许 existsSync 的断链绕过。
  try { lstatSync(target); throw new Error('目标已存在，绝不覆盖；独立组件升级需要另行确认') }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

/** 首次安装：拒绝已有同名目录；staging 校验完成后用 RENAME_EXCL 原子移动。 */
export function installComponent(source = DEFAULT_OUTPUT, target = INSTALL_TARGET): void {
  if (target !== INSTALL_TARGET) throw new Error('安装目标固定为 /Applications/gammaComputerUse.app')
  assertInstallDestinationAbsent(target)
  verifyComponent(source)
  const stagingRoot = mkdtempSync(join(dirname(target), '.gamma-computer-use-install-'))
  const staged = join(stagingRoot, basename(target))
  try {
    cpSync(source, staged, { recursive: true, errorOnExist: true, force: false })
    verifyComponent(staged)
    command('/usr/bin/swift', ['-e', 'import Darwin; let a = CommandLine.arguments; if renamex_np(a[1], a[2], UInt32(RENAME_EXCL)) != 0 { perror("独占安装失败"); exit(1) }', staged, target])
    verifyComponent(target)
  } finally { rmSync(stagingRoot, { recursive: true, force: true }) }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--install') {
    installComponent()
    console.log(`首次安装完成：${INSTALL_TARGET}`)
  } else if (args.length === 0) {
    console.log(buildComponent())
  } else {
    throw new Error('用法：bun build-gamma-computer-use.ts [--install]')
  }
}
