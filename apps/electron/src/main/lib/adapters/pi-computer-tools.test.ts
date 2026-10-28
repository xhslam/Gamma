import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import { Type } from 'typebox'
import { ComputerReobserveRequiredError } from '../computer-controller'
import { loadIsolatedModule } from '../../../test-utils/isolated-module'
const { buildPiComputerTools } = loadIsolatedModule<typeof import('./pi-computer-tools')>(`${import.meta.dir}/pi-computer-tools.ts`, { typebox: { Type }, '../computer-controller': { ComputerReobserveRequiredError }, '../computer-service': { computerController: {} } })
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

  test('Given 新应用观察 When 工具返回 Then 模型获得新ID、AX和差异而renderer状态不包含AX', async () => {
    const mockController = {
      executeAutonomousAction: async () => ({ message: '观察成功', observationId: 'snapshot-new', ax: '[1] ref=fresh AXButton', axDiff: 'AX未变化，引用刷新', image: { data: 'png', mimeType: 'image/png', width: 1, height: 1 }, state: { phase: 'active', supported: true } }),
    } as unknown as ComputerController
    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController).find(t => t.name === 'computer')!
    const output = await tool.execute('new-observe', { action: 'get_app_state', app: 'Notes' }, undefined, undefined, {} as never)
    const text = output.content.find(block => block.type === 'text')
    expect(text?.type === 'text' && text.text).toContain('snapshot-new')
    expect(text?.type === 'text' && text.text).toContain('ref=fresh')
    expect(JSON.stringify(output.details)).not.toContain('ref=fresh')
    expect(JSON.stringify(tool.parameters)).toContain('perform_secondary_action')
    expect(JSON.stringify(tool.parameters)).toContain('observationId')
    expect(output.content.filter(block => block.type === 'image')).toHaveLength(1)
    expect(text?.type === 'text' && text.text).toContain('screenshot-and-ax')
  })

  test('Given 仅辅助功能可用 When 返回无图 AX Then 不报错且引导元素引用或快捷键而非截图坐标', async () => {
    const mockController = {
      executeAutonomousAction: async () => ({ message: '界面可操作，录屏可选', observationId: 'ax-only-new', ax: '[1] ref=editable AXTextArea', state: { phase: 'active', supported: true } }),
    } as unknown as ComputerController
    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController).find(t => t.name === 'computer')!
    const output = await tool.execute('ax-observe', { action: 'get_app_state', app: 'Auris' }, undefined, undefined, {} as never)
    expect(output.content).toHaveLength(1)
    const text = output.content[0]
    expect(text?.type).toBe('text')
    if (text?.type !== 'text') throw new Error('缺少 AX 文本结果')
    const payload = JSON.parse(text.text) as { ax: string; observationId: string; observationMode: string; coordinateHint: string }
    expect(payload.ax).toContain('ref=editable')
    expect(payload.observationId).toBe('ax-only-new')
    expect(payload.observationMode).toBe('ax-only')
    expect(payload.coordinateHint).toContain('元素引用或快捷键')
    expect(payload.coordinateHint).toContain('不可猜测截图坐标')
    expect(JSON.stringify(output.details)).not.toContain('ref=editable')
    expect(tool.description).toContain('录屏可选')
  })

  test('Given 原生权限状态有变化 When 查询 ComputerStatus Then 刷新真实状态而非返回旧缓存', async () => {
    let requestedSession = ''
    const mockController = {
      getState: () => { throw new Error('不应读取旧权限缓存') },
      refreshState: async (sessionId: string) => {
        requestedSession = sessionId
        return { phase: 'disabled', supported: true, permissions: { accessibility: true, screen: false, listen: false, post: false } }
      },
    } as unknown as ComputerController
    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController).find(t => t.name === 'ComputerStatus')!
    const output = await tool.execute('status-refresh', {}, undefined, undefined, {} as never)
    expect(requestedSession).toBe(binding.sessionId)
    const text = output.content[0]
    if (text?.type !== 'text') throw new Error('缺少状态文本结果')
    const payload = JSON.parse(text.text) as { permissions: { accessibility: boolean; screen: boolean } }
    expect(payload.permissions.accessibility).toBe(true)
    expect(payload.permissions.screen).toBe(false)
  })

  test('Given 自动化或协作运行 When 构建工具 Then 不获得用户桌面能力', () => {
    for (const source of ['automation', 'collaboration', 'bridge']) expect(buildPiComputerTools(mockSdk, binding, source)).toEqual([])
  })

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
    expect(result).toMatchObject({ isError: true, terminate: true })
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
    expect(result).toMatchObject({ isError: true, terminate: true })
  })

  test('Given 动作明确未投递 When 请求重新观察 Then 标记失败但允许模型继续观察', async () => {
    const mockController = {
      executeAutonomousAction: async () => { throw new ComputerReobserveRequiredError('元素已失效，动作未投递，请重新观察') },
    } as unknown as ComputerController
    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController).find(t => t.name === 'computer')!
    const output = await tool.execute('recoverable', { action: 'click' }, undefined, undefined, {} as never)
    expect(output.isError).toBe(true)
    expect(output.terminate).not.toBe(true)
    expect(output.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('reobserveRequired') })
  })
})
