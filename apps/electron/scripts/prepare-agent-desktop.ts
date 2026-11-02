#!/usr/bin/env bun
/** 从固定源码提交构建随包分发的 CLI/helper；不使用同版本号的上游 release。 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonFileAtomic } from '../src/main/lib/safe-file'
import { AGENT_DESKTOP_NOTICE, AGENT_DESKTOP_SOURCE, agentDesktopTarget } from './prepare-agent-desktop-manifest'
import type { AgentDesktopTarget } from './prepare-agent-desktop-manifest'

export interface BuildToolchain { rustc: string; host: string; sdk: string }
interface SourceReceipt {
  schemaVersion: number
  commit: string
  repository: string
  version: string
  target: string
  rustToolchain: string
  cargoLockSha256: string
  sourceToolchainSha256: string
  licenseSha256: string
  toolchain: BuildToolchain
  files: Record<string, string>
  builtAt: string
}
export interface PrepareOptions {
  resourcesDir: string
  platform: string
  arch: string
  cacheDir?: string
  sourceDir?: string
  /** 仅供离线单元测试注入，运行入口不接受外部构建命令。 */
  build?: (staging: string, target: AgentDesktopTarget) => BuildToolchain
}

export function computeSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}
function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

export function validateSource(source: string): void {
  if (run('git', ['rev-parse', 'HEAD'], source) !== AGENT_DESKTOP_SOURCE.commit) throw new Error('agent-desktop 源码提交不是固定基线')
  if (run('git', ['status', '--porcelain', '--untracked-files=all'], source)) throw new Error('agent-desktop 源码有未提交改动')
  for (const [name, hash] of [
    ['Cargo.lock', AGENT_DESKTOP_SOURCE.cargoLockSha256],
    ['LICENSE', AGENT_DESKTOP_SOURCE.licenseSha256],
    ['rust-toolchain.toml', AGENT_DESKTOP_SOURCE.toolchainSha256],
  ]) {
    if (computeSha256(join(source, name!)) !== hash) throw new Error(`agent-desktop 源码 SHA-256 不匹配：${name}`)
  }
}

function shippedFiles(target: AgentDesktopTarget): string[] { return [...target.executables, 'LICENSE', 'NOTICES.md'] }
export function isInstalledAndValid(directory: string, target: AgentDesktopTarget): boolean {
  try {
    const receipt = JSON.parse(readFileSync(join(directory, '.source-build.json'), 'utf8')) as SourceReceipt
    if (receipt.schemaVersion !== 1 || receipt.repository !== AGENT_DESKTOP_SOURCE.repository || receipt.commit !== AGENT_DESKTOP_SOURCE.commit || receipt.version !== AGENT_DESKTOP_SOURCE.version || receipt.target !== target.triple || receipt.rustToolchain !== AGENT_DESKTOP_SOURCE.rustToolchain || receipt.cargoLockSha256 !== AGENT_DESKTOP_SOURCE.cargoLockSha256 || receipt.sourceToolchainSha256 !== AGENT_DESKTOP_SOURCE.toolchainSha256 || receipt.licenseSha256 !== AGENT_DESKTOP_SOURCE.licenseSha256) return false
    const names = shippedFiles(target).sort()
    if (JSON.stringify(Object.keys(receipt.files).sort()) !== JSON.stringify(names)) return false
    return names.every(name => {
      const file = join(directory, name)
      const stat = lstatSync(file)
      return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && receipt.files[name] === computeSha256(file)
    })
  } catch { return false }
}

/** 逐字节校验固定源码，不继承 Windows 的全局 CRLF 自动转换；只设置新建缓存仓库。 */
export function initializeAgentDesktopCheckout(directory: string): void {
  run('git', ['init', '-q'], directory)
  run('git', ['config', '--local', 'core.autocrlf', 'false'], directory)
}

function buildFromSource(options: PrepareOptions, staging: string, target: AgentDesktopTarget): BuildToolchain {
  if (options.platform !== process.platform) throw new Error('agent-desktop 必须在目标平台 Runner 上构建')
  const cache = resolve(options.cacheDir ?? join(options.resourcesDir, '..', '.cache', 'agent-desktop'))
  mkdirSync(cache, { recursive: true })
  const source = options.sourceDir ? resolve(options.sourceDir) : join(cache, AGENT_DESKTOP_SOURCE.commit)
  if (!existsSync(source)) {
    const checkout = mkdtempSync(join(cache, '.checkout-'))
    try {
      initializeAgentDesktopCheckout(checkout)
      run('git', ['fetch', '--depth=1', AGENT_DESKTOP_SOURCE.repository, AGENT_DESKTOP_SOURCE.commit], checkout)
      run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout)
      validateSource(checkout)
      renameSync(checkout, source)
    } finally { rmSync(checkout, { recursive: true, force: true }) }
  }
  validateSource(source)
  const rust = AGENT_DESKTOP_SOURCE.rustToolchain
  // 缺少固定工具链时明确失败，不自动升级到 stable。
  const rustc = run('rustup', ['run', rust, 'rustc', '--version', '--verbose'], source)
  if (!rustc.startsWith(`rustc ${rust} `)) throw new Error('agent-desktop Rust 工具链版本不匹配')
  run('rustup', ['target', 'add', '--toolchain', rust, target.triple], source)
  const output = join(cache, 'target', target.triple)
  const cargo = (args: string[]) => execFileSync('rustup', ['run', rust, 'cargo', 'build', '--locked', '--release', '--target', target.triple, '--target-dir', output, ...args], {
    cwd: source, stdio: 'inherit', timeout: 30 * 60_000,
    env: { ...process.env, RUSTFLAGS: '', CARGO_ENCODED_RUSTFLAGS: '' },
  })
  cargo(['-p', 'agent-desktop'])
  if (target.platform === 'darwin') cargo(['-p', 'agent-desktop-macos', '--bin', 'agent-desktop-macos-helper'])
  if (target.platform === 'linux') cargo(['-p', 'agent-desktop-linux', '--bins'])
  // --locked 不应改锁文件；构建脚本也不能污染已核验的源码。
  validateSource(source)
  for (const name of target.executables) copyFileSync(join(output, target.triple, 'release', name), join(staging, name))
  copyFileSync(join(source, 'LICENSE'), join(staging, 'LICENSE'))
  return { rustc, host: `${process.platform}-${process.arch}`, sdk: process.platform === 'darwin' ? run('xcrun', ['--show-sdk-version'], source) : 'system' }
}

export function prepareAgentDesktop(options: PrepareOptions): { executablePath: string; dir: string } {
  const target = agentDesktopTarget(options.platform, options.arch)
  mkdirSync(options.resourcesDir, { recursive: true })
  const directory = join(options.resourcesDir, 'agent-desktop')
  const result = { dir: directory, executablePath: join(directory, target.executables[0]!) }
  if (isInstalledAndValid(directory, target)) {
    console.log(`[prepare-agent-desktop] 已核验源码构建 ${AGENT_DESKTOP_SOURCE.commit.slice(0, 12)} (${target.triple})`)
    return result
  }
  const staging = mkdtempSync(join(options.resourcesDir, '.agent-desktop-build-'))
  const previous = `${staging}.previous`
  try {
    const toolchain = options.build ? options.build(staging, target) : buildFromSource(options, staging, target)
    writeFileSync(join(staging, 'NOTICES.md'), AGENT_DESKTOP_NOTICE)
    const files: Record<string, string> = {}
    for (const name of shippedFiles(target)) {
      const path = join(staging, name)
      if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size === 0) throw new Error(`agent-desktop 构建产物缺失或无效：${name}`)
      if (target.executables.includes(name)) chmodSync(path, 0o755)
      files[name] = computeSha256(path)
    }
    const receipt: SourceReceipt = {
      schemaVersion: 1, repository: AGENT_DESKTOP_SOURCE.repository, commit: AGENT_DESKTOP_SOURCE.commit, version: AGENT_DESKTOP_SOURCE.version,
      target: target.triple, rustToolchain: AGENT_DESKTOP_SOURCE.rustToolchain, cargoLockSha256: AGENT_DESKTOP_SOURCE.cargoLockSha256,
      sourceToolchainSha256: AGENT_DESKTOP_SOURCE.toolchainSha256, licenseSha256: AGENT_DESKTOP_SOURCE.licenseSha256,
      toolchain, files, builtAt: new Date().toISOString(),
    }
    writeJsonFileAtomic(join(staging, '.source-build.json'), receipt, true)
    if (!isInstalledAndValid(staging, target)) throw new Error('agent-desktop 构建产物复核失败')
    if (existsSync(directory)) renameSync(directory, previous)
    try { renameSync(staging, directory) } catch (error) {
      if (existsSync(previous)) renameSync(previous, directory)
      throw error
    }
    rmSync(previous, { recursive: true, force: true })
    return result
  } finally { rmSync(staging, { recursive: true, force: true }) }
}

if (import.meta.main) {
  const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
  prepareAgentDesktop({ resourcesDir, platform: process.env.AGENT_DESKTOP_PLATFORM || process.platform, arch: process.env.AGENT_DESKTOP_ARCH || process.arch, sourceDir: process.env.AGENT_DESKTOP_SOURCE_DIR })
}
