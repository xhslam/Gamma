#!/usr/bin/env bun
/** 仅编译Gamma主应用内的Computer Use CLI；不启动授权、不签名或修改已安装/开发态应用。 */
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
  executable: string
  entitlements: string
  target: string
}
export function computerUseBuildPlan(options: ComputerUseBuildOptions): ComputerUseBuildPlan | null {
  if (options.platform !== 'darwin') return null
  const architecture = options.targetArch ?? options.hostArch
  const swiftArch = architecture === 'arm64' ? 'arm64' : architecture === 'x64' || architecture === 'x86_64' ? 'x86_64' : null
  if (!swiftArch) throw new Error(`不支持的Computer Use目标架构：${architecture}`)
  return {
    sourceDir: resolve(options.appDir, 'native/computer-use'),
    executable: resolve(options.appDir, 'resources/computer-use/gamma-computer-use-helper'),
    entitlements: resolve(options.appDir, 'resources/computer-use/entitlements.plist'),
    target: `${swiftArch}-apple-macosx14.0`,
  }
}
export function buildComputerUseNative(options: ComputerUseBuildOptions): string | null {
  const plan = computerUseBuildPlan(options)
  if (!plan) {
    console.log('[computer-use-native] 跳过（仅macOS）')
    return null
  }
  const staging = `${plan.executable}.build-${process.pid}`
  const stagedEntitlements = `${plan.entitlements}.build-${process.pid}`
  mkdirSync(dirname(plan.executable), { recursive: true })
  try {
    const sources = readdirSync(plan.sourceDir).filter((name) => name.endsWith('.swift')).sort().map((name) => resolve(plan.sourceDir, name))
    if (sources.length === 0) throw new Error('Computer Use Swift源码缺失')
    execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-warnings-as-errors', '-target', plan.target, ...sources, '-o', staging], { stdio: 'inherit' })
    chmodSync(staging, 0o755)
    copyFileSync(resolve(plan.sourceDir, 'entitlements.plist'), stagedEntitlements)
    renameSync(stagedEntitlements, plan.entitlements)
    renameSync(staging, plan.executable)
    // 只清理本仓库生成的旧嵌套app，避免再次交付独立APPL身份；不触碰已安装应用或TCC配置。
    rmSync(resolve(dirname(plan.executable), 'Gamma Computer Use Helper.app'), { recursive: true, force: true })
    console.log(`[computer-use-native] 已构建裸CLI（未启动授权或执行应用签名）：${plan.executable}`)
    return plan.executable
  } finally {
    rmSync(staging, { force: true })
    rmSync(stagedEntitlements, { force: true })
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
