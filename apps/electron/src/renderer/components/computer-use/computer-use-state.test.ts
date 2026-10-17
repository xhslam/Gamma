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
  resumeComputerUseAtom,
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
    resumeComputer: async () => state({ resumeRequired: false }),
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


describe('Given 侧栏桌面重新启用', () => {
  test('When 用户从暂停状态重新启用 Then 回到待命且不启动截屏', async () => {
    let resumes = 0
    const { store } = setup({
      getComputerState: async () => state({ phase: 'paused', resumeRequired: true }),
      resumeComputer: async () => { resumes++; return state({ resumeRequired: false }) },
    })
    await store.set(refreshComputerUseAtom)
    await store.set(resumeComputerUseAtom)
    expect(resumes).toBe(1)
    expect(store.get(computerUseViewAtom)).toMatchObject({ pending: null, error: null, state: { phase: 'disabled', resumeRequired: false } })
  })

  test('When 恢复失败 Then 保留暂停状态与可重试错误', async () => {
    const { store } = setup({
      getComputerState: async () => state({ phase: 'paused' }),
      resumeComputer: async () => { throw new Error('旧 helper 未停止') },
    })
    await store.set(refreshComputerUseAtom)
    await store.set(resumeComputerUseAtom)
    expect(store.get(computerUseViewAtom)).toMatchObject({ pending: null, error: '旧 helper 未停止', state: { phase: 'paused' } })
  })

  test('When 恢复在途时再次点击并停止 Then 不重复恢复且停止优先于迟到响应', async () => {
    let resolveResume!: (value: ComputerState) => void
    let resumes = 0
    const { store } = setup({ resumeComputer: () => { resumes++; return new Promise(resolve => { resolveResume = resolve }) } })
    const resuming = store.set(resumeComputerUseAtom)
    await store.set(resumeComputerUseAtom)
    await store.set(stopComputerUseAtom)
    resolveResume(state({ phase: 'active' }))
    await resuming
    expect(resumes).toBe(1)
    expect(store.get(computerUseViewAtom)).toMatchObject({ pending: null, state: { phase: 'disabled' } })
  })
})
