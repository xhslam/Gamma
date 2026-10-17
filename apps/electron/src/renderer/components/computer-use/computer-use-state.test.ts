import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { ComputerState } from '@gamma/shared'
import {
  computerUseApiAtom,
  computerUsePanelOpenAtom,
  computerUseViewAtom,
  refreshComputerUseAtom,
  selectComputerSessionAtom,
  stopComputerUseAtom,
} from '../../atoms/computer-use'
import type { ComputerUseAPI } from '../../atoms/computer-use'

function state(overrides: Partial<ComputerState> = {}): ComputerState {
  return { supported: true, phase: 'disabled', ...overrides }
}

function setup(overrides: Partial<ComputerUseAPI> = {}) {
  const store = createStore()
  const calls: { reads: (string | undefined)[]; stops: number } = {
    reads: [],
    stops: 0,
  }
  const api: ComputerUseAPI = {
    getComputerState: async (sessionId) => {
      calls.reads.push(sessionId)
      return state({ sessionId: sessionId ?? undefined })
    },
    stopComputer: async () => {
      calls.stops++
      return state({ phase: 'disabled' })
    },
    ...overrides,
  }
  store.set(computerUseApiAtom, api)
  return { store, calls }
}

describe('可信桌面面板状态（离线 Jotai store）', () => {
  test('Given 全新 store When 读取会话 Then 面板默认关闭且状态初始为空', async () => {
    const { store, calls } = setup()
    expect(store.get(computerUsePanelOpenAtom)).toBe(false)
    expect(store.get(computerUseViewAtom).sessionId).toBeNull()
    await store.set(selectComputerSessionAtom, 'session-1')
    expect(calls.reads).toEqual(['session-1'])
    expect(store.get(computerUseViewAtom).sessionId).toBe('session-1')
    expect(store.get(computerUseViewAtom).state?.supported).toBe(true)
  })

  test('Given 正在操作桌面 When 用户触发停止 Then 调用 stopComputer 并更新状态', async () => {
    const { store, calls } = setup({
      getComputerState: async () => state({ phase: 'active' }),
    })
    await store.set(refreshComputerUseAtom)
    expect(store.get(computerUseViewAtom).state?.phase).toBe('active')

    await store.set(stopComputerUseAtom)
    expect(calls.stops).toBe(1)
    expect(store.get(computerUseViewAtom).pending).toBeNull()
    expect(store.get(computerUseViewAtom).state?.phase).toBe('disabled')
  })

  test('Given 后台读取失败 When 发生异常 Then 正确记录错误信息并不崩溃', async () => {
    const { store } = setup({
      getComputerState: async () => {
        throw new Error('网络异常无法连接原生服务')
      },
    })
    await store.set(refreshComputerUseAtom)
    expect(store.get(computerUseViewAtom).error).toBe('网络异常无法连接原生服务')
    expect(store.get(computerUseViewAtom).loading).toBe(false)
  })
})
