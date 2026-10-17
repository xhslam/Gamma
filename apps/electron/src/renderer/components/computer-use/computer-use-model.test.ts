import { describe, expect, test } from 'bun:test'
import type { ComputerState } from '@gamma/shared'
import {
  getComputerStatusLabel,
  hasComputerControl,
  projectComputerState,
  type ComputerUseView,
} from './computer-use-model'

const state: ComputerState = {
  supported: true,
  phase: 'disabled',
}

describe('桌面控制状态视图与投影模型', () => {
  test('Given 非敏感 renderer 状态投影 When 接收目标和观察扩展字段 Then 不保留目标、截图或 AX', () => {
    const incoming = {
      ...state,
      target: { windowId: 1, pid: 2, processIdentity: 'private', bundleId: 'private', title: 'PRIVATE_TITLE', bounds: { x: 0, y: 0, width: 1, height: 1 } },
      pendingAction: { actionId: 'action-1', kind: 'type' as const },
      screenshot: 'PRIVATE_IMAGE',
      ax: 'PRIVATE_AX',
    } as unknown as ComputerState
    const projected = projectComputerState(incoming)
    expect(projected.pendingAction).toEqual({ actionId: 'action-1', kind: 'type' })
    expect(JSON.stringify(projected)).not.toContain('PRIVATE')
    expect((projected as unknown as Record<string, unknown>).target).toBeUndefined()
  })

  test('Given 各种控制 phase When 判断是否处于控制中 Then 正确返回', () => {
    expect(hasComputerControl(null)).toBe(false)
    expect(hasComputerControl({ supported: true, phase: 'disabled' })).toBe(false)
    expect(hasComputerControl({ supported: true, phase: 'active' })).toBe(true)
    expect(hasComputerControl({ supported: true, phase: 'paused' })).toBe(true)
    expect(hasComputerControl({ supported: true, phase: 'stopping' })).toBe(true)
  })

  test('Given view 状态 When 获取标签 Then 准确反映待机/活动/暂停/错误状态', () => {
    const baseView: ComputerUseView = {
      sessionId: 's1',
      state: null,
      loading: false,
      pending: null,
      error: null,
    }
    expect(getComputerStatusLabel(baseView)).toBe('桌面状态未知')
    expect(getComputerStatusLabel({ ...baseView, loading: true })).toBe('正在读取桌面状态')
    expect(getComputerStatusLabel({ ...baseView, pending: 'stop' })).toBe('正在停止')
    expect(getComputerStatusLabel({ ...baseView, error: '连接失败' })).toBe('桌面状态异常')
    expect(getComputerStatusLabel({
      ...baseView,
      state: { supported: true, phase: 'active' },
    })).toBe('正在操作桌面')
    expect(getComputerStatusLabel({
      ...baseView,
      state: { supported: true, phase: 'active', pendingAction: { actionId: '1', kind: 'click' } },
    })).toBe('等待确认操作')
  })
})
