import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import { buildPiComputerTools } from './pi-computer-tools'
import type { ComputerController } from '../computer-controller'

describe('Pi computer 工具中断结果与错误处理', () => {
  const binding: ComputerBinding = {
    sessionId: 'session-test-interrupt',
    runId: 'run-1',
    channelId: 'channel-test',
    modelId: 'model-test',
  }

  // 模拟精简的 Pi SDK
  const mockSdk = {
    defineTool: (def: unknown) => def,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')

  test('Given 操作被用户接管或手动停止中断 When execute 执行 Then 将原因作为工具结果返回给 Agent 而不抛异常', async () => {
    const mockController = {
      executeAutonomousAction: async () => {
        throw new Error('检测到用户接管或原生安全门暂停；发新任务或说“继续”后开始新动作')
      },
      isRunStopped: () => true,
      getLastStopReason: () => '检测到用户接管或原生安全门暂停',
    } as unknown as ComputerController

    const tools = buildPiComputerTools(mockSdk, binding, 'user', mockController)
    const computerTool = tools.find(t => t.name === 'computer')
    expect(computerTool).toBeDefined()

    const result = await computerTool!.execute('call-1', { action: 'click', coordinate: [100, 200] }, undefined, undefined, {} as never) as {
      content: Array<{ type: string; text?: string }>
      details?: Record<string, unknown>
    }

    expect(result.details?.interrupted).toBe(true)
    expect(result.details?.reason).toBe('检测到用户接管或原生安全门暂停')
    expect(result.content[0]?.text).toContain('桌面操作已中断')
    expect(result.content[0]?.text).toContain('不会自动重放旧动作')
  })

  test('Given 操作被手动停止 When execute 执行 Then 返回手动停止原因', async () => {
    const mockController = {
      executeAutonomousAction: async () => {
        throw new Error('本地用户停止')
      },
      isRunStopped: () => true,
      getLastStopReason: () => '用户点击独立原生停止按钮',
    } as unknown as ComputerController

    const tools = buildPiComputerTools(mockSdk, binding, 'user', mockController)
    const computerTool = tools.find(t => t.name === 'computer')

    const result = await computerTool!.execute('call-2', { action: 'screenshot' }, undefined, undefined, {} as never) as {
      content: Array<{ type: string; text?: string }>
      details?: Record<string, unknown>
    }

    expect(result.details?.interrupted).toBe(true)
    expect(result.details?.reason).toBe('用户点击独立原生停止按钮')
    expect(result.content[0]?.text).toContain('桌面操作已中断：用户点击独立原生停止按钮')
  })
})
