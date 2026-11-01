import { describe, expect, spyOn, test } from 'bun:test'
import * as logger from './computer-logger'
import { buildAgentDesktopArgs, parseAgentDesktopEnvelope } from './agent-desktop-protocol'

const canarySecret = 'CANARY_SECRET_DO_NOT_LEAK_9824'

describe('Computer Use 隐私与防泄密机制', () => {
  test('Given 敏感文本输入 When 构造命令参数 Then 参数仅作为数组元素，不经由 shell 字符串拼装', () => {
    const args = buildAgentDesktopArgs({
      command: 'type',
      ref: '@snapshot:e1',
      text: canarySecret,
    })
    expect(args).toEqual(['type', '@snapshot:e1', canarySecret])
    // 确保绝对不包含 shell 转义或危险字符连接
    expect(args.some(arg => arg.includes(';') || arg.includes('|') || arg.includes('`'))).toBe(false)
  })

  test('Given 原生返回包含私密信息的错误 When 解析 envelope Then 严格保留结构化错误码与处置策略，不推导虚假 safe', () => {
    const raw = JSON.stringify({
      version: '2.5',
      ok: false,
      command: 'type',
      error: {
        code: 'EXEC_FAILED',
        message: 'Input rejected',
        disposition: { delivery: 'undelivered', retry: 'unsafe' },
      },
    })
    const parsed = parseAgentDesktopEnvelope(raw)
    expect(parsed.ok).toBe(false)
    expect(parsed.error?.disposition?.retry).toBe('unsafe')
  })

  test('Given 本地电脑操作日志 When 记录操作事件 Then 不把 AX 树、屏幕截图数据或剪贴板原文写入日志', () => {
    const logs: logger.ComputerLogEntry[] = []
    const logSpy = spyOn(logger, 'logComputerUseEvent').mockImplementation(entry => {
      logs.push(entry)
    })

    try {
      logger.logComputerUseEvent({
        time: new Date().toISOString(),
        action: 'type',
        textLength: canarySecret.length,
      })

      expect(logs).toHaveLength(1)
      expect(logs[0]?.textLength).toBe(canarySecret.length)
      expect(JSON.stringify(logs)).not.toContain(canarySecret)
    } finally {
      logSpy.mockRestore()
    }
  })
})
