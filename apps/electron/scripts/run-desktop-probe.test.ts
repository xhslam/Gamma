import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// 旧脚本在 import 时会运行并可能注入鼠标事件，先验证入口隔离，禁止测试触发旧副作用。
const source = readFileSync(new URL('./run-desktop-probe.ts', import.meta.url), 'utf8')
if (!source.includes('if (import.meta.main)')) {
  throw new Error('探针脚本必须隔离 CLI 入口；测试不得导入会自动执行桌面动作的旧脚本')
}
const { parseProbeOptions, validateProbeReport, probeExitCode } = await import('./run-desktop-probe')

const requiredIds = ['live-event-tap', 'live-preemption', 'live-occlusion', 'live-capture-alignment', 'live-ax-raise']
function report(status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP', phase0Ready = false) {
  return {
    schemaVersion: 2,
    runMode: 'self-test',
    timestamp: '2026-10-16T15:00:00Z',
    osVersion: 'fixture',
    architecture: 'arm64',
    phase0Ready,
    results: requiredIds.map(id => ({ id, status, evidence: 'integration', detail: 'fixture' })),
  }
}

describe('Given 原生 Phase 0 探针 CLI', () => {
  test('When 未指定参数 Then 默认仅运行离线自测', () => {
    expect(parseProbeOptions([])).toEqual({ mode: 'self-test', buildOnly: false })
  })
  test('When 仅编译 Then 不执行探针', () => {
    expect(parseProbeOptions(['--build-only']).buildOnly).toBe(true)
  })
  test('When 请求权限预检 Then 不自动开启 live 模式', () => {
    expect(parseProbeOptions(['--preflight']).mode).toBe('preflight')
  })
  test('When 请求注入却未明确确认 Then 拒绝而非悄悄运行', () => {
    expect(() => parseProbeOptions(['--live-event-tap'])).toThrow()
    expect(() => parseProbeOptions(['--acknowledge-desktop-input'])).toThrow()
    expect(parseProbeOptions(['--live-event-tap', '--acknowledge-desktop-input']).mode).toBe('live-event-tap')
  })
  test('When 参数未知、重复或模式冲突 Then 拒绝', () => {
    for (const args of [['--oops'], ['--preflight', '--self-test'], ['--preflight', '--preflight'], ['--build-only', '--live-event-tap', '--acknowledge-desktop-input']]) {
      expect(() => parseProbeOptions(args)).toThrow()
    }
  })
})

describe('Given 结构化探针结果', () => {
  test('When 有 FAIL Then 退出码非零', () => {
    expect(probeExitCode(validateProbeReport(report('FAIL')))).toBe(1)
  })
  test('When 验证被阻塞或跳过 Then 不得归为完成，也不伪造失败', () => {
    const blocked = validateProbeReport(report('BLOCKED'))
    expect(probeExitCode(blocked)).toBe(0)
    expect(blocked.phase0Ready).toBe(false)
  })
  test('When gate 全部通过 Then 允许宣布 ready', () => {
    expect(validateProbeReport(report('PASS', true)).phase0Ready).toBe(true)
  })
  test('When 伪造 ready、丢失 gate 或重复结果 Then 拒绝', () => {
    expect(() => validateProbeReport(report('SKIP', true))).toThrow()
    expect(() => validateProbeReport({ ...report('PASS', true), results: [] })).toThrow()
    const duplicate = report('SKIP')
    duplicate.results.push(duplicate.results[0]!)
    expect(() => validateProbeReport(duplicate)).toThrow()
  })
  test('When PASS 仅来自配置或权限证据 Then 不得宣布 gate ready', () => {
    for (const evidence of ['configuration', 'permission', 'logic']) {
      const forged = report('PASS', true)
      forged.results = forged.results.map(item => ({ ...item, evidence }))
      expect(() => validateProbeReport(forged)).toThrow()
    }
  })
  test('When 其他检查失败 Then 即使集成 gate 通过也不能 ready', () => {
    const inconsistent = report('PASS', true)
    inconsistent.results.push({ id: 'additional-check', status: 'FAIL', evidence: 'logic', detail: 'fixture' })
    expect(() => validateProbeReport(inconsistent)).toThrow()
  })
  test('When 仅编译却又指定运行模式 Then 拒绝', () => {
    expect(() => parseProbeOptions(['--build-only', '--self-test'])).toThrow()
    expect(() => parseProbeOptions(['--build-only', '--preflight'])).toThrow()
  })
  test('When 输出不符合协议 Then 拒绝', () => {
    for (const value of [null, {}, { ...report('SKIP'), results: [{ passed: true }] }, { ...report('SKIP'), phase0Ready: 'yes' }]) {
      expect(() => validateProbeReport(value)).toThrow()
    }
  })
})
