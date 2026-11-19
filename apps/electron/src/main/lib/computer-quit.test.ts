import { describe, expect, test } from 'bun:test'
import { createComputerQuitBarrier } from './computer-quit'

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Given 应用退出需要确认桌面执行者停止', () => {
  test('When 停止尚未完成 Then 持续阻止退出，确认后只继续一次退出', async () => {
    let release!: () => void
    const stopped = new Promise<void>(resolve => { release = resolve })
    let quits = 0
    let prevented = 0
    const barrier = createComputerQuitBarrier({
      stop: () => stopped,
      phase: () => 'disabled',
      quit: () => { quits++ },
      onFailure: error => { throw error },
    })
    expect(barrier(() => { prevented++ })).toBe(false)
    expect(barrier(() => { prevented++ })).toBe(false)
    expect(prevented).toBe(2)
    expect(quits).toBe(0)
    release()
    await flush()
    expect(quits).toBe(1)
    expect(barrier(() => { prevented++ })).toBe(true)
    expect(prevented).toBe(2)
  })

  test('When stop resolve 但控制器仍报告 error Then 不继续退出，并允许之后重试', async () => {
    let phase = 'error'
    let failures = 0
    let quits = 0
    let stops = 0
    const barrier = createComputerQuitBarrier({
      stop: async () => { stops++ },
      phase: () => phase,
      quit: () => { quits++ },
      onFailure: () => { failures++ },
    })
    expect(barrier(() => {})).toBe(false)
    await flush()
    expect({ failures, quits, stops }).toEqual({ failures: 1, quits: 0, stops: 1 })
    phase = 'disabled'
    expect(barrier(() => {})).toBe(false)
    await flush()
    expect({ failures, quits, stops }).toEqual({ failures: 1, quits: 1, stops: 2 })
  })
})
