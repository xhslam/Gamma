import { describe, expect, test } from 'bun:test'
import { classifyComputerFailure, missingComputerPermissionMessage, PAUSE_CODES, REOBSERVE_CODES } from './computer-failure-policy'

describe('Given 原生投递证据 When 分类 Then 未知结果优先于准备错误码', () => {
  for (const code of REOBSERVE_CODES) test(`准备阶段 ${code} 可恢复，投递后不可推断未投递`, () => {
    expect(classifyComputerFailure({ code, phase: 'prepare' })).toBe('reobserve')
    expect(classifyComputerFailure({ code, phase: 'perform' })).toBe('pause')
    for (const outcome of ['unknown', 'outcome-unknown', 'dispatched-unverified']) expect(classifyComputerFailure({ code, outcome, phase: 'prepare' })).toBe('pause')
  })
  for (const code of PAUSE_CODES) test(`${code} 不因 not-dispatched 放宽`, () => {
    expect(classifyComputerFailure({ code, outcome: 'not-dispatched', phase: 'prepare' })).toBe('pause')
  })
  test('明确未投递可恢复；旧 rejected 无错误码、未知异常、动作后观察错误均暂停', () => {
    expect(classifyComputerFailure({ outcome: 'not-dispatched', phase: 'perform' })).toBe('reobserve')
    expect(classifyComputerFailure({ outcome: 'rejected', phase: 'perform' })).toBe('pause')
    expect(classifyComputerFailure({ code: 'new-code', phase: 'prepare' })).toBe('pause')
    expect(classifyComputerFailure({ code: 'unsafe-focus', outcome: 'not-dispatched', phase: 'after-dispatch' })).toBe('pause')
  })
  for (const permission of ['accessibility', 'screen', 'listen', 'post'] as const) test(`缺少 ${permission} 明确告知权限及替代路径`, () => {
    expect(classifyComputerFailure({ code: 'permission-required', permission, phase: 'prepare' })).toBe('permission')
    expect(missingComputerPermissionMessage(permission)).toContain('缺少 ')
    expect(missingComputerPermissionMessage(permission)).toContain('改用不依赖该权限')
  })
})
