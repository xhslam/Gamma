import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyComputerValidationFailure } from './pi-computer-validation-log'
import { validateOrStripComputerObservations } from './pi-agent-adapter'
import { configureComputerLogPath, getComputerLogPath } from '../computer-logger'

describe('Given 电脑观察外发核验失败', () => {
  test.each([
    ['电脑工具不属于当前有效运行', 'not-active-run'],
    ['电脑操作只允许前台用户运行', 'non-foreground'],
    ['本轮电脑操作已暂停；请发送新任务或说“继续”，不会重放旧动作', 'run-paused'],
    ['截图外发同意已撤销', 'consent-revoked'],
    ['缺少电脑外发核验', 'lease-missing'],
    ['Agent runtime is shutting down', 'ipc-error'],
    ['Agent runtime port is not connected', 'ipc-error'],
    ['Main runtime request timed out: agent.capability.computerValidate', 'ipc-error'],
    ['Main runtime request aborted: agent.capability.computerValidate', 'ipc-error'],
    ['Main request failed: agent.capability.computerValidate', 'ipc-error'],
  ] as const)('When 错误文案为 %s Then 使用枚举 %s 且不记录原文', (message, reason) => {
    // Utility 的 RPC 将主进程错误重建为 Error，并附加通信错误码。
    const result = classifyComputerValidationFailure(Object.assign(new Error(message), { code: 'runtime.main_handler_failed' }))
    expect(result).toEqual({ reason })
    expect(JSON.stringify(result)).not.toContain(message)
  })

  test('When 错误只是包含固定文案或是未知异常 Then 仅记录名称与长度', () => {
    const message = '私人文本：截图外发同意已撤销'
    const error = new TypeError(message)
    expect(classifyComputerValidationFailure(error)).toEqual({ reason: 'unknown', errorName: 'TypeError', messageLength: message.length })
    expect(JSON.stringify(classifyComputerValidationFailure(error))).not.toContain(message)
    expect(classifyComputerValidationFailure('私人文本')).toEqual({ reason: 'unknown' })
  })
  test('When 异常属性访问自身失败 Then 分类仍不会抛出', () => {
    const error = new Error()
    Object.defineProperty(error, 'message', { get() { throw new Error('不可读取') } })
    expect(classifyComputerValidationFailure(error)).toEqual({ reason: 'unknown' })
  })
  test('When 外发核验抛错 Then 真正记录 JSONL 并剥离观察；取消时不记录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-validation-log-'))
    const previousPath = getComputerLogPath()
    configureComputerLogPath(join(root, 'computer-use.log'))
    const messages = [{ role: 'toolResult' as const, timestamp: 1, toolCallId: 'call-1', toolName: 'computer', isError: false, content: [{ type: 'text' as const, text: 'PRIVATE_OBSERVATION' }] }]
    try {
      const result = await validateOrStripComputerObservations(messages, {
        sessionId: 'session-1', runId: 'run-1', createAbortError: () => new Error('aborted'),
        validate: async () => { throw new Error('截图外发同意已撤销') },
      })
      const line = readFileSync(join(root, 'computer-use.log'), 'utf8').trim()
      expect(JSON.parse(line)).toMatchObject({ event: 'validate-failed', reason: 'consent-revoked', sessionId: 'session-1', runId: 'run-1', outcome: 'stripped' })
      expect(line).not.toContain('截图外发同意已撤销')
      expect(JSON.stringify(result)).not.toContain('PRIVATE_OBSERVATION')
      const controller = new AbortController(); controller.abort()
      await expect(validateOrStripComputerObservations(messages, {
        sessionId: 'session-1', runId: 'run-1', signal: controller.signal, createAbortError: () => new Error('aborted'),
        validate: async () => { throw new Error('截图外发同意已撤销') },
      })).rejects.toThrow('aborted')
      expect(readFileSync(join(root, 'computer-use.log'), 'utf8').trim()).toBe(line)
      console.log('[JSONL validate-failed]', line)
    } finally {
      configureComputerLogPath(previousPath)
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Given 按核验原因生成占位文本', () => {
  for (const [message, reason] of [
    ['电脑工具不属于当前有效运行', 'not-active-run'], ['电脑操作只允许前台用户运行', 'non-foreground'],
    ['截图外发同意已撤销', 'consent-revoked'], ['缺少电脑外发核验', 'lease-missing'],
    ['Agent runtime port is not connected', 'ipc-error'], ['不确定原因', 'unknown'],
  ]) test(`When ${reason} Then 原因准确且不会重复 strip`, async () => {
    const { hasComputerObservationContent, stripComputerObservationContent } = await import('./pi-computer-context')
    const messages = [{ role: 'toolResult' as const, timestamp: 1, toolCallId: 'one', toolName: 'computer', isError: false, content: [{ type: 'text' as const, text: 'PRIVATE_AX' }] }]
    const result = await validateOrStripComputerObservations(messages, { sessionId: 's', runId: 'r', createAbortError: () => new Error('abort'), validate: async () => { throw new Error(message) } })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_AX')
    expect(JSON.stringify(result)).toContain(reason === 'consent-revoked' ? '[电脑观察外发同意已撤销' : `核验失败（${reason}）`)
    expect(hasComputerObservationContent(result)).toBe(false)
    expect(stripComputerObservationContent(result, 'unknown')).toEqual(result)
  })
  test('When 主进程暂停原因通过 RPC 序列化 Then Utility 占位包含实际停止原因且混合新观察仍会剥离', async () => {
    const { ComputerRunPausedError } = await import('../computer-pause')
    const { serializeAgentRuntimeError } = await import('@gamma/shared')
    const { hasComputerObservationContent, stripComputerObservationContent } = await import('./pi-computer-context')
    const serialized = JSON.parse(JSON.stringify(serializeAgentRuntimeError(new ComputerRunPausedError('物理键鼠接管急停'))))
    const rpcError = Object.assign(new Error(serialized.message), serialized)
    const messages = [{ role: 'toolResult' as const, timestamp: 1, toolCallId: 'one', toolName: 'computer', isError: false, content: [{ type: 'text' as const, text: 'PRIVATE_AX' }] }]
    const result = await validateOrStripComputerObservations(messages, { sessionId: 's', runId: 'r', createAbortError: () => new Error('abort'), validate: async () => { throw rpcError } })
    expect(JSON.stringify(result)).toContain('[电脑观察未外发：本轮电脑操作已暂停（原因：物理键鼠接管急停）；此前观察已从本次模型请求省略]')
    expect(hasComputerObservationContent(result)).toBe(false)
    expect(stripComputerObservationContent(result, 'unknown')).toEqual(result)
    const mixed = [...result, ...messages]
    expect(hasComputerObservationContent(mixed)).toBe(true)
    expect(JSON.stringify(stripComputerObservationContent(mixed, 'run-paused', '物理键鼠接管急停'))).not.toContain('PRIVATE_AX')
  })
})
