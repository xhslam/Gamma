import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'
import { createComputerToolsFixture } from '../../test-utils/computer-tools-fixture'
import { ComputerNativeHostError } from './computer-native-host'
import { ComputerReobserveRequiredError } from './computer-controller'

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
  for (const code of ['stale-element-ref', 'observation-layout-changed', 'ambiguous-selection']) {
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
