import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AGENT_DESKTOP_SOURCE, agentDesktopTarget } from './prepare-agent-desktop-manifest'
import { computeSha256, isInstalledAndValid, prepareAgentDesktop, validateSource } from './prepare-agent-desktop'

function temporary(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'gamma-desktop-source-'))
  try { run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

const mac = agentDesktopTarget('darwin', 'arm64')
function fakeBuild(directory: string): void {
  for (const name of mac.executables) writeFileSync(join(directory, name), `built ${name}`)
  writeFileSync(join(directory, 'LICENSE'), 'license')
}
const toolchain = { rustc: 'rustc 1.89.0 (test)', host: 'test-host', sdk: 'test-sdk' }

describe('Given agent-desktop 固定源码构建', () => {
  it('When 选择六个平台目标 Then 包含对应 CLI 和必要 helper', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const arch of ['arm64', 'x64']) {
        const target = agentDesktopTarget(platform, arch)
        expect(target.executables).toHaveLength(platform === 'win32' ? 1 : 2)
        expect(target.triple).toContain(arch === 'arm64' ? 'aarch64' : 'x86_64')
      }
    }
    expect(() => agentDesktopTarget('freebsd', 'arm64')).toThrow('不支持')
    expect(() => agentDesktopTarget('darwin', 'ia32')).toThrow('不支持')
  })

  it('When 只有旧 release 元数据 Then 不允许复用', () => temporary(directory => {
    writeFileSync(join(directory, '.release.json'), JSON.stringify({ version: '1.0.2' }))
    expect(isInstalledAndValid(directory, mac)).toBe(false)
  }))

  it('When 成功构建 Then 原子安装并记录源码和逐文件哈希，篡改后拒绝复用', () => temporary(directory => {
    let calls = 0
    const options = { resourcesDir: directory, platform: 'darwin', arch: 'arm64', build: (stage: string) => { calls++; fakeBuild(stage); return toolchain } }
    const result = prepareAgentDesktop(options)
    expect(calls).toBe(1)
    expect(isInstalledAndValid(result.dir, mac)).toBe(true)
    const receipt = JSON.parse(readFileSync(join(result.dir, '.source-build.json'), 'utf8'))
    expect(receipt.commit).toBe(AGENT_DESKTOP_SOURCE.commit)
    expect(receipt.toolchain).toEqual(toolchain)
    expect(receipt.files['agent-desktop']).toBe(computeSha256(result.executablePath))
    prepareAgentDesktop(options)
    expect(calls).toBe(1)
    writeFileSync(result.executablePath, 'tampered')
    expect(isInstalledAndValid(result.dir, mac)).toBe(false)
    prepareAgentDesktop(options)
    expect(calls).toBe(2)
    writeFileSync(join(result.dir, 'NOTICES.md'), 'tampered notice')
    expect(isInstalledAndValid(result.dir, mac)).toBe(false)
  }))

  it('When 构建失败或产物缺失 Then 不破坏旧安装', () => temporary(directory => {
    const target = join(directory, 'agent-desktop')
    mkdirSync(target)
    writeFileSync(join(target, 'old'), 'preserve')
    expect(() => prepareAgentDesktop({ resourcesDir: directory, platform: 'darwin', arch: 'arm64', build: () => { throw new Error('build failed') } })).toThrow('build failed')
    expect(() => prepareAgentDesktop({ resourcesDir: directory, platform: 'darwin', arch: 'arm64', build: () => toolchain })).toThrow('产物')
    expect(readFileSync(join(target, 'old'), 'utf8')).toBe('preserve')
  }))

  it('When receipt 提交、目标或文件路径不匹配 Then 拒绝复用', () => temporary(directory => {
    const result = prepareAgentDesktop({ resourcesDir: directory, platform: 'darwin', arch: 'arm64', build: stage => { fakeBuild(stage); return toolchain } })
    const path = join(result.dir, '.source-build.json')
    const original = readFileSync(path, 'utf8')
    for (const change of [{ commit: AGENT_DESKTOP_SOURCE.rejectedReleaseCommit }, { target: 'wrong' }, { files: { '../outside': 'bad' } }, { rustToolchain: 'stable' }, { cargoLockSha256: 'wrong' }]) {
      writeFileSync(path, JSON.stringify({ ...JSON.parse(original), ...change }))
      expect(isInstalledAndValid(result.dir, mac)).toBe(false)
    }
  }))

  it('When 本地源码不在指定提交或存在未提交改动 Then 拒绝执行构建', () => temporary(directory => {
    execFileSync('git', ['init', '-q', directory])
    execFileSync('git', ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
    expect(() => validateSource(directory)).toThrow('提交')
  }))
})

it('Given Git 全局启用 autocrlf When 初始化自有源码缓存 Then 本地禁用转换且 checkout 保留 LF', () => temporary(directory => {
  const source = join(directory, 'source')
  mkdirSync(source)
  const config = join(directory, 'gitconfig')
  writeFileSync(config, '[core]\n\tautocrlf = true\n')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' }
  execFileSync(process.execPath, ['-e', `import { initializeAgentDesktopCheckout } from ${JSON.stringify(resolve(import.meta.dir, 'prepare-agent-desktop.ts'))}; initializeAgentDesktopCheckout(${JSON.stringify(source)});`], { env, stdio: 'pipe' })
  expect(execFileSync('git', ['config', '--local', '--get', 'core.autocrlf'], { cwd: source, env, encoding: 'utf8' }).trim()).toBe('false')
  const file = join(source, 'LICENSE')
  writeFileSync(file, 'fixed source\nLF only\n')
  execFileSync('git', ['add', 'LICENSE'], { cwd: source, env, stdio: 'pipe' })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: source, env, stdio: 'pipe' })
  rmSync(file)
  execFileSync('git', ['checkout', '--', 'LICENSE'], { cwd: source, env, stdio: 'pipe' })
  expect(readFileSync(file, 'utf8')).toBe('fixed source\nLF only\n')
}))

it('Given Release 工作流 When 固定源码构建 Then 安装与清单一致的 Rust 版本', () => {
  const workflow = readFileSync(resolve(import.meta.dir, '../../../.github/workflows/release.yml'), 'utf8')
  expect(workflow).toContain(`rustup toolchain install ${AGENT_DESKTOP_SOURCE.rustToolchain} --profile minimal`)
})
