import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createComputerFixture } from '../../test-utils/computer-fixture'
import { ComputerNativeHost } from './computer-native-host'
import { configureComputerLogPath, getComputerLogPath, logComputerUseEvent, type ComputerLogEntry } from './computer-logger'

describe('Given 非文本电脑动作的实际 JSONL 日志', () => {
  test('When key、click、focus 的原生请求失败 Then 停止前写完整原生诊断；可恢复的焦点失败不停止', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamma-log-test-'))
    const originalPath = getComputerLogPath()
    const path = join(dir, 'computer-use.log')
    configureComputerLogPath(path)
    let nativeCode = 'permission-required'
    const native = new ComputerNativeHost(() => ({ executable: process.execPath, args: ['-e', `
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const q=JSON.parse(line); if(q.method==='stop') process.exit(0);
        process.stdout.write(JSON.stringify({id:q.id,ok:false,error:{code:q.params.code,message:q.params.message ?? '原生模拟错误原文'}})+'\\n');
      });
    `] }))
    const readEntries = (): ComputerLogEntry[] => readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as ComputerLogEntry)
    try {
      logComputerUseEvent({ time: '2026-01-01T00:00:00.000Z', event: 'logger-ready', process: 'main', version: 'test-version', pid: process.pid })
      for (const kind of ['key', 'click', 'focus_window'] as const) {
        const fixture = createComputerFixture({ call: async (method) => {
          if (method === 'perform') return native.call('perform', { code: nativeCode })
          return undefined
        } })
        try {
          const observed = kind === 'click' ? await fixture.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, fixture.binding) : undefined
          const params = kind === 'key' ? { action: kind, key: 'cmd+n' } : kind === 'click' ? { action: kind, coordinate: [0, 0] as [number, number], observationId: observed?.observationId } : { action: kind, windowId: 12 }
          await expect(fixture.controller.executeAutonomousAction(params, undefined, fixture.binding)).rejects.toThrow()
          const entries = readEntries()
          const errorIndex = entries.findLastIndex(entry => entry.event === 'native-error' && entry.action === kind)
          const stopIndex = entries.findLastIndex(entry => entry.event === 'stop-before' && entry.action === kind)
          expect(errorIndex).toBeGreaterThanOrEqual(0)
          expect(stopIndex).toBeGreaterThan(errorIndex)
          expect(entries[errorIndex]).toMatchObject({ action: kind, rawError: '原生模拟错误原文', errorCode: 'permission-required', outcome: 'unknown', reason: '原生操作失败或授权失效' })
          expect(entries[stopIndex]).toMatchObject({ action: kind, rawError: '原生模拟错误原文', errorCode: 'permission-required', outcome: 'unknown', reason: '原生操作失败或授权失效' })
        } finally { await fixture.controller.finishRun(fixture.binding) }
      }
      nativeCode = 'unsafe-focus'
      const fixture = createComputerFixture({ call: async (method) => method === 'prepare' ? native.call('prepare', { code: nativeCode }) : undefined })
      try {
        await expect(fixture.controller.executeAutonomousAction({ action: 'key', key: 'cmd+n' }, undefined, fixture.binding)).rejects.toThrow()
        expect(fixture.controller.isRunStopped(fixture.binding.runId)).toBe(false)
        const entries = readEntries()
        expect(entries.findLast(entry => entry.event === 'unsafe-focus')).toMatchObject({ action: 'key', rawError: '原生模拟错误原文', errorCode: 'unsafe-focus', outcome: 'not-dispatched', reason: '准备未完成，请重新观察' })
      } finally { await fixture.controller.finishRun(fixture.binding) }
      const textSecret = 'TEXT_FROM_NATIVE_83c1'
      const textFixture = createComputerFixture({ call: async (method) => method === 'perform' ? native.call('perform', { code: textSecret, message: textSecret }) : undefined })
      try {
        await expect(textFixture.controller.executeAutonomousAction({ action: 'type', text: textSecret }, undefined, textFixture.binding)).rejects.toThrow()
        const textLogs = readEntries().filter(entry => entry.action === 'type')
        expect(textLogs.some(entry => entry.textLength === textSecret.length)).toBe(true)
        expect(JSON.stringify(textLogs)).not.toContain(textSecret)
      } finally { await textFixture.controller.finishRun(textFixture.binding) }
      const entries = readEntries()
      for (const event of ['stop-before', 'native-error', 'unsafe-focus', 'logger-ready']) {
        const entry = entries.find(item => item.event === event)
        expect(entry).toBeDefined()
        process.stdout.write(`[JSONL sample] ${JSON.stringify(entry)}\n`)
      }
    } finally {
      await native.terminate()
      configureComputerLogPath(originalPath)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
