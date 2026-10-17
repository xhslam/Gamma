#!/usr/bin/env bun
/** 构建原生 Phase 0 探针。默认仅离线自测，真实事件投递必须显式选择并确认。 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, rmdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ProbeOptions {
  mode: 'self-test' | 'preflight' | 'live-event-tap'
  buildOnly: boolean
}
export interface ProbeResult {
  id: string
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP'
  evidence: 'logic' | 'configuration' | 'permission' | 'integration'
  detail: string
}
export interface ProbeReport {
  schemaVersion: 2
  timestamp: string
  osVersion: string
  architecture: string
  runMode: ProbeOptions['mode']
  phase0Ready: boolean
  results: ProbeResult[]
}
const gateIds = ['live-event-tap', 'live-preemption', 'live-occlusion', 'live-capture-alignment', 'live-ax-raise']

export function parseProbeOptions(args: string[]): ProbeOptions {
  const allowed = new Set(['--build-only', '--self-test', '--preflight', '--live-event-tap', '--acknowledge-desktop-input'])
  if (new Set(args).size !== args.length || args.some(arg => !allowed.has(arg))) throw new Error('参数未知或重复')
  const modes = args.filter(arg => ['--self-test', '--preflight', '--live-event-tap'].includes(arg))
  if (modes.length > 1) throw new Error('不能同时选择多个运行模式')
  const mode = (modes[0]?.slice(2) ?? 'self-test') as ProbeOptions['mode']
  const live = mode === 'live-event-tap'
  if (live !== args.includes('--acknowledge-desktop-input')) {
    throw new Error('真实事件投递须同时指定 --live-event-tap --acknowledge-desktop-input；不得单独确认或隐式开启')
  }
  if (args.includes('--build-only') && modes.length > 0) throw new Error('仅编译模式不能混用运行模式')
  return { mode, buildOnly: args.includes('--build-only') }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isText(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096 }
export function validateProbeReport(value: unknown): ProbeReport {
  if (!isRecord(value) || value.schemaVersion !== 2 || typeof value.phase0Ready !== 'boolean'
    || !isText(value.timestamp) || !isText(value.osVersion) || !isText(value.architecture)
    || !['self-test', 'preflight', 'live-event-tap'].includes(String(value.runMode))
    || !Array.isArray(value.results) || value.results.length > 100) throw new Error('探针报告协议无效')
  const results: ProbeResult[] = []
  const ids = new Set<string>()
  for (const item of value.results) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.detail)
      || !['PASS', 'FAIL', 'BLOCKED', 'SKIP'].includes(String(item.status))
      || !['logic', 'configuration', 'permission', 'integration'].includes(String(item.evidence))
      || ids.has(item.id)) throw new Error('探针结果缺字段、重复或状态无效')
    ids.add(item.id)
    results.push({ id: item.id, status: item.status as ProbeResult['status'], evidence: item.evidence as ProbeResult['evidence'], detail: item.detail })
  }
  if (gateIds.some(id => !ids.has(id))) throw new Error('报告遗漏真实验证 gate，不能推断为通过')
  const ready = !results.some(item => item.status === 'FAIL') && gateIds.every(id => results.some(item => item.id === id && item.status === 'PASS' && item.evidence === 'integration'))
  if (ready !== value.phase0Ready) throw new Error('phase0Ready 与真实验证证据不一致')
  return {
    schemaVersion: 2, timestamp: value.timestamp, osVersion: value.osVersion, architecture: value.architecture,
    runMode: value.runMode as ProbeOptions['mode'], phase0Ready: ready, results,
  }
}
export function probeExitCode(report: ProbeReport): number {
  return report.results.some(item => item.status === 'FAIL') ? 1 : 0
}
export function main(args = process.argv.slice(2)): number {
  const options = parseProbeOptions(args)
  if (process.platform !== 'darwin') {
    console.error('[desktop-probe] BLOCKED：仅支持 macOS，未执行验证')
    return 2
  }
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const source = resolve(appDir, 'native/desktop-helper/test-desktop-probe.swift')
  const output = resolve(appDir, 'native/desktop-helper/bin/test-desktop-probe')
  const temporary = `${output}.${process.pid}.next`
  if (!existsSync(source)) throw new Error(`探针源码不存在：${source}`)
  mkdirSync(dirname(output), { recursive: true })
  // 覆盖编译与执行的原子目录锁，避免并发进程在 spawn 前替换固定产物。
  // 崩溃残留锁不自动抢占；需用户确认没有在途探针后人工清理。
  const lock = resolve(dirname(output), '.probe-lock')
  try { mkdirSync(lock) }
  catch { throw new Error('探针构建/运行锁已占用，或目录不可写；未执行。异常残留锁须核实无运行进程后人工清理') }
  try {
    console.error('[desktop-probe] 正在编译；不重签 Gamma、不请求权限')
    try {
      execFileSync('xcrun', ['swiftc', '-O', '-parse-as-library', source, '-o', temporary], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 60_000 })
      chmodSync(temporary, 0o755)
      renameSync(temporary, output)
    } finally {
      rmSync(temporary, { force: true })
    }
    if (options.buildOnly) { console.error('[desktop-probe] 编译通过，未运行探针'); return 0 }
    const nativeArgs = options.mode === 'live-event-tap'
      ? ['--live-event-tap', '--acknowledge-desktop-input'] : [`--${options.mode}`]
    const run = spawnSync(output, nativeArgs, { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
    if (run.error) throw run.error
    if (run.stderr) process.stderr.write(run.stderr)
    if (run.signal || run.status === null) throw new Error('探针异常终止，不能推断验证通过')
    const report = validateProbeReport(JSON.parse(run.stdout) as unknown)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    console.error(`[desktop-probe] Phase 0 ${report.phase0Ready ? '真实 gate 全部通过' : '尚未完成真实验收（详见 BLOCKED / SKIP）'}`)
    return run.status === 0 ? probeExitCode(report) : run.status
  } finally {
    rmdirSync(lock)
  }
}
if (import.meta.main) {
  try { process.exitCode = main() }
  catch (error) { console.error('[desktop-probe]', error instanceof Error ? error.message : error); process.exitCode = 1 }
}
