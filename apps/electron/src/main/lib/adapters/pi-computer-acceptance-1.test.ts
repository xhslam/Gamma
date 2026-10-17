import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { ComputerController, type ComputerHost } from '../computer-controller'
import { buildPiComputerTools } from './pi-computer-tools'
import { compactComputerScreenshots } from './pi-computer-context'

describe('验收用例 1: 打开备忘录，新建一条笔记，写上‘测试’', () => {
  const binding: ComputerBinding = {
    sessionId: 'session-test-notes',
    runId: 'run-1',
    channelId: 'channel-test',
    modelId: 'anthropic/claude-3-7-sonnet',
  }

  function createTestHarness() {
    const executedActions: Array<{ actionId?: string; kind?: string; [key: string]: unknown }> = []
    const calls: string[] = []

    const host: ComputerHost = {
      async call(method, params) {
        calls.push(method)
        if (method === 'select') {
          return {
            target: {
              windowId: 0,
              pid: 0,
              processIdentity: 'desktop-full',
              bundleId: 'com.apple.desktop',
              title: 'Full Desktop',
              bounds: { x: 0, y: 0, width: 1440, height: 900 },
            },
          }
        }
        if (method === 'observe') {
          return {
            observationId: `obs-${Date.now()}-${calls.length}`,
            epoch: 1,
            image: {
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0m0AAAAASUVORK5CYII=',
              mimeType: 'image/png',
              width: 1,
              height: 1,
            },
            ax: 'AX_NOTES_CANARY',
          }
        }
        if (method === 'perform') {
          executedActions.push(params?.action as Record<string, unknown>)
          return {
            actionId: params?.actionId,
            outcome: 'dispatched-unverified',
            message: '动作已投递',
          }
        }
        return {
          supported: true,
          permissions: { accessibility: true, screen: true, listen: true, post: true },
        }
      },
      async terminate() {
        calls.push('terminate')
      },
    }

    const controller = new ComputerController(host, { supported: true, now: () => Date.now() })
    return { controller, calls, executedActions }
  }

  test('Given 用户要求“打开备忘录，新建一条笔记，写上‘测试’” When Agent 自主循环调用 computer 工具 Then 全程无需人工手动确认，动作正确按序投递并返回截图', async () => {
    const { controller, calls, executedActions } = createTestHarness()

    // 模拟 Pi Sdk defineTool
    const mockSdk = {
      defineTool: (def: any) => def,
    } as any

    const tools = buildPiComputerTools(mockSdk, binding, 'user')
    const computerTool = tools.find((t) => t.name === 'computer')
    expect(computerTool).toBeDefined()

    // 步骤 1: 打开备忘录
    const step1 = await controller.executeAutonomousAction({
      action: 'open_app',
      app: 'Notes',
    })

    expect(calls).toContain('select')
    expect(calls).toContain('perform')
    expect(calls).toContain('observe')
    expect(step1.message).toContain('open_app')
    expect(step1.message).toContain('Notes')
    expect(step1.image.data).toBeDefined()
    expect(step1.image.mimeType).toBe('image/png')
    expect(executedActions[0]?.kind).toBe('open_app')
    expect(executedActions[0]?.appName).toBe('Notes')

    // 步骤 2: 快捷键新建笔记 Command + N
    const step2 = await controller.executeAutonomousAction({
      action: 'key',
      key: 'cmd+n',
    })

    expect(step2.message).toContain('key')
    expect(step2.message).toContain('cmd+n')
    expect(step2.image.data).toBeDefined()
    expect(executedActions[1]?.kind).toBe('key')
    expect(executedActions[1]?.key).toBe('cmd+n')

    // 步骤 3: 输入中文文字 “测试”
    const step3 = await controller.executeAutonomousAction({
      action: 'type',
      text: '测试',
    })

    expect(step3.message).toContain('type')
    expect(step3.message).toContain('测试')
    expect(step3.image.data).toBeDefined()
    expect(executedActions[2]?.kind).toBe('type')
    expect(executedActions[2]?.text).toBe('测试')

    // 验证整个过程中没有弹窗阻断或额外确认请求
    expect(executedActions.length).toBe(3)
  })

  test('Given 连续执行多次电脑操作 When 产生多张历史截图 Then 自动修剪仅保留最新截图，避免上下文爆炸', () => {
    const messages: AgentMessage[] = [
      {
        role: 'user',
        timestamp: 1,
        content: [{ type: 'text', text: '打开备忘录，新建一条笔记，写上‘测试’。' }],
      },
      {
        role: 'toolResult',
        timestamp: 2,
        toolCallId: 'c1',
        toolName: 'computer',
        isError: false,
        content: [
          { type: 'text', text: '已打开' },
          { type: 'image', data: 'SCREENSHOT_1', mimeType: 'image/png' },
        ],
      },
      {
        role: 'toolResult',
        timestamp: 3,
        toolCallId: 'c2',
        toolName: 'computer',
        isError: false,
        content: [
          { type: 'text', text: '已新建' },
          { type: 'image', data: 'SCREENSHOT_2', mimeType: 'image/png' },
        ],
      },
      {
        role: 'toolResult',
        timestamp: 4,
        toolCallId: 'c3',
        toolName: 'computer',
        isError: false,
        content: [
          { type: 'text', text: '已输入' },
          { type: 'image', data: 'SCREENSHOT_3', mimeType: 'image/png' },
        ],
      },
    ]

    const compacted = compactComputerScreenshots(messages, 2)
    const json = JSON.stringify(compacted)

    // 最早的一张截图 (SCREENSHOT_1) 被替换为文字说明
    expect(json).not.toContain('SCREENSHOT_1')
    expect(json).toContain('[历史屏幕截图已省略以节约上下文]')

    // 最近的两张截图 (SCREENSHOT_2, SCREENSHOT_3) 完整保留
    expect(json).toContain('SCREENSHOT_2')
    expect(json).toContain('SCREENSHOT_3')
  })
})
