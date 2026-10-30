import { describe, expect, test } from 'bun:test'
import { createComputerFixture, tinyComputerImage } from '../../test-utils/computer-fixture'
import { createComputerToolsFixture } from '../../test-utils/computer-tools-fixture'
import { ComputerNativeHostError } from './computer-native-host'
import { ComputerReobserveRequiredError } from './computer-controller'

describe('Given 已有明确投递回执的后置观察', () => {
  test('When 页面内容持续更新 Then 返回超时状态和最新观察，不暂停或重放', async () => {
    let reads = 0
    const f = createComputerFixture({ call: async (method, params) => {
      if (method === 'observe') return { observationId: `dynamic-${++reads}`, epoch: params.epoch, image: tinyComputerImage,
        ax: `ref=fresh-${reads} 0 AXTextArea value=stream-${reads}`, targetApp: { name: 'Notes', bundleId: 'com.apple.Notes' } }
    } })
    try {
      const result = await f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)
      expect(result.observationStability).toBe('timeout')
      expect(result.ax).toContain(`stream-${reads}`)
      expect(result.observationId).toBeDefined()
      expect(result.message).toContain('不要重放')
      expect(f.actions).toHaveLength(1)
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 只读观察暂时无法确认焦点 Then 保留已投递事实但不给出失效引用', async () => {
    let dispatched = false
    const f = createComputerFixture({ call: async method => {
      if (method === 'perform') dispatched = true
      if (method === 'observe' && dispatched) throw new ComputerNativeHostError('unsafe-focus', '观察目标暂不可用')
    } })
    try {
      const result = await f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)
      expect(result.observationStability).toBe('timeout')
      expect(result.observationId).toBeUndefined()
      expect(result.ax).toBeUndefined()
      expect(result.image).toBeUndefined()
      expect(result.message).toContain('已投递')
      expect(f.actions).toHaveLength(1)
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  for (const code of ['revoked', 'secure-input', 'listen-disabled', 'ax-timeout']) {
    test(`When 后置观察发生 ${code} Then 仍停止，不把安全故障当普通动态内容`, async () => {
      let dispatched = false
      const f = createComputerFixture({ call: async method => {
        if (method === 'perform') dispatched = true
        if (method === 'observe' && dispatched) throw new ComputerNativeHostError(code, '安全状态失效')
      } })
      try {
        await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toThrow()
        expect(f.actions).toHaveLength(1)
        expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
      } finally { await f.controller.finishRun(f.binding) }
    })
  }
})

describe('Given 观察绑定与投递前拒绝', () => {
  test('When 坐标动作没有ID、ID过期或不匹配 Then 不刷新截图也不投递', async () => {
    for (const action of ['click', 'double_click', 'triple_click', 'right_click', 'middle_click', 'mouse_move', 'scroll', 'drag']) {
      for (const observationId of [undefined, 'wrong', 'expired']) {
        const f = createComputerFixture()
        const initial = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
        if (observationId === 'expired') f.advance(31_000)
        const before = f.calls.length
        await expect(f.controller.executeAutonomousAction({ action, coordinate: [0, 0], start_coordinate: [0, 0], observationId: observationId === 'expired' ? initial.observationId : observationId }, undefined, f.binding)).rejects.toBeInstanceOf(ComputerReobserveRequiredError)
        expect(f.calls.length).toBe(before)
        expect(f.actions).toHaveLength(0)
        expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
        await f.controller.finishRun(f.binding)
      }
    }
  })
  for (const code of ['stale-element-ref', 'observation-layout-changed', 'ambiguous-selection', 'untrusted-surface']) {
    test(`When prepare 返回 ${code} Then 同轮可重新观察但不会自动重放`, async () => {
      let fail = true
      const f = createComputerToolsFixture({ call: async method => { if (method === 'prepare' && fail) throw new ComputerNativeHostError(code, '需要新观察') } })
      const observed = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
      const response = await f.execute({ action: 'click', coordinate: [0, 0], observationId: observed.observationId })
      expect(response.details).toMatchObject({ interrupted: false, reobserveRequired: true, outcome: 'rejected' })
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
      expect(f.actions).toHaveLength(0)
      expect(f.calls.some(call => call.method === 'terminate')).toBe(false)
      fail = false
      const fresh = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
      await f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: fresh.observationId }, undefined, f.binding)
      expect(f.actions).toHaveLength(1)
      await f.controller.finishRun(f.binding)
    })
  }
  test('When 权限撤销或未知错误 Then 仍暂停本轮', async () => {
    for (const code of ['revoked', 'unknown']) {
      const f = createComputerFixture({ call: async method => { if (method === 'prepare') throw new ComputerNativeHostError(code, '不能证明安全') } })
      const observation = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
      await expect(f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: observation.observationId }, undefined, f.binding)).rejects.toThrow()
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
      expect(f.actions).toHaveLength(0)
      await f.controller.finishRun(f.binding)
    }
  })
})
