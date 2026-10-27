import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'
import { ComputerReobserveRequiredError } from './computer-controller'
import { createComputerNativeHostError } from './computer-native-host'
import { ComputerRunPausedError } from './computer-pause'

describe('Given 可恢复失败的运行 When 重新观察 Then 有界恢复并保留暂停边界', () => {
  test('同轮可继续；观察不清除连续计数，第三次同动作失败暂停', async () => {
    let fail = true
    const f = createComputerFixture({ call: async method => {
      if (method === 'prepare' && fail) throw createComputerNativeHostError({ code: 'unsafe-focus', message: 'focus unavailable' })
    } })
    const click = async () => {
      const obs = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
      return f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: obs.observationId }, undefined, f.binding)
    }
    await expect(click()).rejects.toBeInstanceOf(ComputerReobserveRequiredError)
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    fail = false
    await click()
    expect(f.actions).toHaveLength(1)
    fail = true
    await expect(click()).rejects.toBeInstanceOf(ComputerReobserveRequiredError)
    await expect(click()).rejects.toBeInstanceOf(ComputerReobserveRequiredError)
    await expect(click()).rejects.toBeInstanceOf(ComputerRunPausedError)
    expect(f.controller.getRunStopReason(f.binding.runId)).toContain('连续失败，已暂停')
    expect(f.controller.toolDenialMessage(f.binding, new Error())).toContain('不要再调用 computer 工具；请向用户说明情况并等待新的消息。')
    await f.controller.finishRun(f.binding)
  })
  test('同目标不同动作的第三次失败仍暂停', async () => {
    const f = createComputerFixture({ call: async method => { if (method === 'prepare') throw createComputerNativeHostError({ code: 'invalid-key' }) } })
    for (const [index, action] of ['click', 'double_click', 'right_click'].entries()) {
      const obs = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
      await expect(f.controller.executeAutonomousAction({ action, coordinate: [0, 0], observationId: obs.observationId }, undefined, f.binding)).rejects.toBeInstanceOf(index === 2 ? ComputerRunPausedError : ComputerReobserveRequiredError)
    }
    await f.controller.finishRun(f.binding)
  })
  for (const [permission, name] of [['accessibility', '辅助功能'], ['screen', '屏幕录制'], ['listen', '输入监听'], ['post', '事件发布']] as const) test(`缺少 ${name} 不暂停且可继续`, async () => {
    let fail = true
    const f = createComputerFixture({ call: async method => { if (method === 'prepare' && fail) throw createComputerNativeHostError({ code: 'permission-required', permission }) } })
    const obs = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
    await expect(f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: obs.observationId }, undefined, f.binding)).rejects.toThrow(`缺少 ${name} 权限`)
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    fail = false
    await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
    await f.controller.finishRun(f.binding)
  })
  for (const outcome of ['not-dispatched', 'outcome-unknown', 'unknown']) test(`perform ${outcome} 服从回执证据`, async () => {
    const f = createComputerFixture({ call: async (method, params) => method === 'perform' ? { actionId: params.actionId, outcome, errorCode: 'invalid-key' } : undefined })
    await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
    await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'ESC' }, undefined, f.binding)).rejects.toThrow()
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(outcome !== 'not-dispatched')
    await f.controller.finishRun(f.binding)
  })
  test('物理接管后即便恢复观察也不得继续', async () => {
    const f = createComputerFixture()
    await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
    f.controller.nativeStopped('物理键鼠接管')
    await expect(f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)).rejects.toThrow()
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
    await f.controller.finishRun(f.binding)
  })
})

describe('Given 无法证明未投递 When 出错 Then 禁止同轮继续', () => {
  for (const code of ['ax-timeout', 'revoked', 'listen-disabled', 'unknown-native-code']) test(`准备阶段 ${code} 仍暂停`, async () => {
    const f = createComputerFixture({ call: async method => { if (method === 'prepare') throw createComputerNativeHostError({ code }) } })
    await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toThrow()
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
    await f.controller.finishRun(f.binding)
  })
  for (const message of ['helper exited', 'request timed out']) test(`${message} 仍暂停`, async () => {
    const f = createComputerFixture({ call: async method => { if (method === 'perform') throw new Error(message) } })
    await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toThrow()
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
    await f.controller.finishRun(f.binding)
  })
  test('动作已投递后的观察即使报告准备错误也暂停，不重放', async () => {
    let dispatched = false
    const f = createComputerFixture({ call: async method => {
      if (method === 'perform') dispatched = true
      if (method === 'observe' && dispatched) throw createComputerNativeHostError({ code: 'unsafe-focus' })
    } })
    await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toThrow()
    expect(f.actions).toHaveLength(1)
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
    await f.controller.finishRun(f.binding)
  })
  test('开始前已 abort 仍标记暂停', async () => {
    const f = createComputerFixture()
    const abort = new AbortController(); abort.abort()
    await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, abort.signal, f.binding)).rejects.toThrow()
    expect(f.actions).toHaveLength(0)
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
    await f.controller.finishRun(f.binding)
  })
})
