import { describe, expect, test } from 'bun:test'
import {
  UTILITY_PROCESS_START_CANCELLED_CODE,
  isRetryableUtilityProcessStartupError,
  startUtilityProcessWithRetry,
} from './utility-process-startup'

describe('utility process 启动重试', () => {
  test('Given Windows 同步 ENOTCONN When 启动重试 Then 使用有限退避并返回成功进程', async () => {
    let attempts = 0
    const delays: number[] = []

    const result = await startUtilityProcessWithRetry(() => {
      attempts++
      if (attempts < 3) {
        const error = new Error('read ENOTCONN') as Error & { code: string }
        error.code = 'ENOTCONN'
        throw error
      }
      return 'started'
    }, {
      platform: 'win32',
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })

    expect(result).toBe('started')
    expect(attempts).toBe(3)
    expect(delays).toEqual([25, 100])
  })

  test('Given Windows ENOTCONN 退避期间被停止 When 再次启动 Then 返回显式取消错误', async () => {
    let shouldContinue = true
    const error = new Error('read ENOTCONN') as Error & { code: string }
    error.code = 'ENOTCONN'

    await expect(startUtilityProcessWithRetry(() => {
      throw error
    }, {
      platform: 'win32',
      shouldContinue: () => shouldContinue,
      sleep: async () => { shouldContinue = false },
    })).rejects.toMatchObject({
      code: UTILITY_PROCESS_START_CANCELLED_CODE,
      cause: error,
    })
  })

  test('Given 非 Windows 平台或非 ENOTCONN When 启动失败 Then 不重试', () => {
    const enotconn = new Error('read ENOTCONN') as Error & { code: string }
    enotconn.code = 'ENOTCONN'

    expect(isRetryableUtilityProcessStartupError(enotconn, 'darwin')).toBe(false)
    expect(isRetryableUtilityProcessStartupError(new Error('other failure'), 'win32')).toBe(false)
  })
})
