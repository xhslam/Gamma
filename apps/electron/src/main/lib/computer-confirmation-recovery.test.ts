import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'
import { ComputerReobserveRequiredError } from './computer-controller'
import { createComputerNativeHostError } from './computer-native-host'
import { ComputerRunPausedError } from './computer-pause'

describe('Given 本地确认后的焦点恢复 When 动作尚未投递 Then 按准备阶段处理', () => {
  function fixture(failure: () => Error | undefined) {
    const f = createComputerFixture({ trustedApps: false, call: async (method, params) => {
      if (method === 'confirmation' && params.waiting === false) {
        const error = failure()
        if (error) throw error
      }
    } })
    f.auth.setUiHandlers({ appAuth: async () => 'once' })
    return f
  }
  test('焦点恢复超时不暂停；重新观察后同轮仍可完成动作', async () => {
    let fail = true
    const f = fixture(() => fail ? createComputerNativeHostError({ code: 'desktop-not-ready' }) : undefined)
    try {
      await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toBeInstanceOf(ComputerReobserveRequiredError)
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
      expect(f.calls.some(call => call.method === 'perform')).toBe(false)
      fail = false
      await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
      await f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)
      expect(f.actions).toHaveLength(1)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('连续三次确认恢复失败仍暂停，不因重复观察清空计数', async () => {
    const f = fixture(() => createComputerNativeHostError({ code: 'desktop-not-ready' }))
    try {
      for (let index = 0; index < 3; index++) {
        // 每次撤销本轮临时应用授权，确保再次经过完整确认与恢复阶段。
        f.auth.clearRun(f.binding.runId)
        await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
        await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toBeInstanceOf(index === 2 ? ComputerRunPausedError : ComputerReobserveRequiredError)
      }
      expect(f.controller.getRunStopReason(f.binding.runId)).toContain('连续失败，已暂停')
      expect(f.calls.some(call => call.method === 'perform')).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  for (const error of [new Error('helper timed out'), createComputerNativeHostError({ code: 'ax-timeout' }), createComputerNativeHostError({ code: 'desktop-not-ready' }, 'unknown')]) {
    test(`确认阶段 ${error.message} 仍保守暂停`, async () => {
      const f = fixture(() => error)
      try {
        await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toThrow()
        expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
        expect(f.calls.some(call => call.method === 'perform')).toBe(false)
      } finally { await f.controller.finishRun(f.binding) }
    })
  }
})
