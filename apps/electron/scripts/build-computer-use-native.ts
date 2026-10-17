#!/usr/bin/env bun
/** 只构建独立Computer Use bundle；不运行正常入口、不签名或修改已安装/开发态应用。 */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ComputerUseBuildOptions {
  appDir: string
  platform: string
  hostArch: string
  targetArch?: string
}
export interface ComputerUseBuildPlan {
  sourceDir: string
  bundle: string
  executableName: string
  target: string
}
export function computerUseBuildPlan(options: ComputerUseBuildOptions): ComputerUseBuildPlan | null {
  if (options.platform !== 'darwin') return null
  const architecture = options.targetArch ?? options.hostArch
  const swiftArch = architecture === 'arm64' ? 'arm64' : architecture === 'x64' || architecture === 'x86_64' ? 'x86_64' : null
  if (!swiftArch) throw new Error(`不支持的Computer Use目标架构：${architecture}`)
  return {
    sourceDir: resolve(options.appDir, 'native/computer-use'),
    bundle: resolve(options.appDir, 'resources/computer-use/Gamma Computer Use Helper.app'),
    executableName: 'Gamma Computer Use Helper',
    target: `${swiftArch}-apple-macosx14.0`,
  }
}
export function buildComputerUseNative(options: ComputerUseBuildOptions): string | null {
  const plan = computerUseBuildPlan(options)
  if (!plan) {
    console.log('[computer-use-native] 跳过（仅macOS）')
    return null
  }
  const staging = `${plan.bundle}.build-${process.pid}`
  const contents = resolve(staging, 'Contents')
  const executable = resolve(contents, 'MacOS', plan.executableName)
  mkdirSync(dirname(executable), { recursive: true })
  mkdirSync(resolve(contents, 'Resources'), { recursive: true })
  try {
    const sources = readdirSync(plan.sourceDir).filter((name) => name.endsWith('.swift')).sort().map((name) => resolve(plan.sourceDir, name))
    if (sources.length === 0) throw new Error('Computer Use Swift源码缺失')
    execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-warnings-as-errors', '-target', plan.target, ...sources, '-o', executable], { stdio: 'inherit' })
    chmodSync(executable, 0o755)
    copyFileSync(resolve(plan.sourceDir, 'Info.plist'), resolve(contents, 'Info.plist'))
    copyFileSync(resolve(plan.sourceDir, 'entitlements.plist'), resolve(contents, 'Resources/entitlements.plist'))
    // 仅替换本仓库生成目录内的旧构建产物。绝不调用codesign、open或任何helper正常入口。
    rmSync(plan.bundle, { recursive: true, force: true })
    renameSync(staging, plan.bundle)
    const output = resolve(plan.bundle, 'Contents/MacOS', plan.executableName)
    console.log(`[computer-use-native] 已构建（未执行应用签名）：${output}`)
    return output
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
if (import.meta.main) {
  buildComputerUseNative({
    appDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    platform: process.platform,
    hostArch: process.arch,
    targetArch: process.env.TARGET_ARCH,
  })
}
