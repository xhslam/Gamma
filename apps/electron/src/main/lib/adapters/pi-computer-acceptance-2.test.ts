import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ComputerController, type ComputerHost } from '../computer-controller'
import { ComputerAuthorizationManager } from '../computer-authorization-manager'
import { buildPiComputerTools } from './pi-computer-tools'

describe('验收用例 2: 在 Safari 里搜索今天的天气，把结果告诉我', () => {
  const binding: ComputerBinding = {
    sessionId: 'session-test-safari-weather',
    runId: 'run-weather-1',
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
            observationId: `obs-safari-${Date.now()}-${calls.length}`,
            epoch: 1,
            image: {
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0m0AAAAASUVORK5CYII=',
              mimeType: 'image/png',
              width: 1,
              height: 1,
            },
            ax: 'AX_SAFARI_WEATHER_CANARY',
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

    const tempConfig = join(tmpdir(), `gamma-test-safari-${randomUUID()}.json`)
    const authManager = new ComputerAuthorizationManager(tempConfig)
    const controller = new ComputerController(host, {
      supported: true,
      now: () => Date.now(),
      authManager,
    })

    return { controller, authManager, calls, executedActions }
  }

  test('Given 用户要求“在 Safari 里搜索今天的天气” When Agent 首次打开 Safari 并输入回车搜索 Then 触发单次应用授权并记忆，回车键不被作为高风险拦截，成功获取搜索结果快照', async () => {
    const { controller, authManager, calls, executedActions } = createTestHarness()

    // 1. 设置应用授权监听，模拟用户选择“总是允许”操作 Safari
    let promptedApp = ''
    authManager.setUiHandlers({
      appAuth: async (req) => {
        promptedApp = req.appName
        return 'always'
      },
      riskConfirm: async () => {
        throw new Error('不应触发高风险拦截')
      },
    })

    const mockSdk = {
      defineTool: (def: any) => def,
    } as any

    const tools = buildPiComputerTools(mockSdk, binding, 'user')
    const computerTool = tools.find((t) => t.name === 'computer')
    expect(computerTool).toBeDefined()

    // 步骤 1: 打开 Safari
    const step1 = await controller.executeAutonomousAction({
      action: 'open_app',
      app: 'Safari',
    })

    expect(promptedApp).toBe('Safari')
    expect(authManager.checkAppAuthorization('Safari')).toBe('allowed')
    expect(calls).toContain('perform')
    expect(step1.message).toContain('open_app')
    expect(step1.message).toContain('Safari')
    expect(executedActions[0]?.kind).toBe('open_app')
    expect(executedActions[0]?.appName).toBe('Safari')

    // 步骤 2: 在 Safari 地址栏/搜索框中输入“今天的天气”
    const step2 = await controller.executeAutonomousAction({
      action: 'type',
      text: '今天的天气',
    })

    expect(step2.message).toContain('type')
    expect(step2.message).toContain('今天的天气')
    expect(executedActions[1]?.kind).toBe('type')
    expect(executedActions[1]?.text).toBe('今天的天气')

    // 步骤 3: 按下 Return 确认搜索
    // 关键点：回车键在搜索/地址栏场景下属于低风险，绝不能被当作不可逆表单提交而拦截
    const step3 = await controller.executeAutonomousAction({
      action: 'key',
      key: 'Return',
    })

    expect(step3.message).toContain('key')
    expect(step3.message).toContain('Return')
    expect(executedActions[2]?.kind).toBe('key')
    expect(executedActions[2]?.key).toBe('Return')

    // 步骤 4: 截取屏幕观察天气结果
    const step4 = await controller.executeAutonomousAction({
      action: 'screenshot',
    })

    expect(step4.message).toContain('屏幕截图')
    expect(step4.image.data).toBeDefined()

    // 再次调用 Safari 动作时，因已授权“总是允许”，不再弹窗提示
    let rePrompted = false
    authManager.setUiHandlers({
      appAuth: async () => {
        rePrompted = true
        return 'always'
      },
    })

    await controller.executeAutonomousAction({
      action: 'scroll',
      delta_y: -300,
    })
    expect(rePrompted).toBe(false)
  })
})
