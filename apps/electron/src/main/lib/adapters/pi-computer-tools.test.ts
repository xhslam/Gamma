import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { buildPiComputerTools } from './pi-computer-tools'
import type { ComputerController } from '../computer-controller'
import type { AgentDesktopEnvelope } from '../agent-desktop-protocol'
import { ComputerRunPausedError } from '../computer-pause'
import { compactComputerScreenshots } from './pi-computer-context'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Value } from 'typebox/value'

describe('Pi computer 工具集成 agent-desktop 协议', () => {
  const binding: ComputerBinding = {
    sessionId: 'session-test-ad',
    runId: 'run-1',
    channelId: 'channel-test',
    modelId: 'model-test',
  }

  const mockSdk = {
    defineTool: (def: unknown) => def,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')

  test('Given 非 user 触发来源 When 构建工具 Then 不暴露桌面能力', () => {
    for (const source of ['automation', 'collaboration', 'bridge']) {
      expect(buildPiComputerTools(mockSdk, binding, source)).toEqual([])
    }
  })

  test('Given user 触发来源 When 构建工具 Then 注册 computer 工具且参数包含 60 个命令', () => {
    const mockController = {} as ComputerController
    const tools = buildPiComputerTools(mockSdk, binding, 'user', mockController)
    expect(tools).toHaveLength(1)
    const tool = tools[0]!
    expect(tool.name).toBe('computer')
    expect(tool.description).toContain('agent-desktop')
    expect(tool.description).toContain('@snapshot:eN')
  })

  test('Given snapshot 命令 When 成功执行 Then 返回完整 envelope 且包含 partial 状态', async () => {
    const mockEnvelope: AgentDesktopEnvelope = {
      version: '2.5',
      ok: true,
      command: 'snapshot',
      data: {
        snapshot_id: 'snap-1',
        complete: false,
        nodes_observed: 42,
        tree: { role: 'window', title: 'Notes' },
      },
    }

    const mockController = {
      execute: async () => mockEnvelope,
    } as unknown as ComputerController

    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController)[0]!
    const output = (await tool.execute('call-1', { command: 'snapshot', app: 'Notes' }, undefined, undefined, {} as ExtensionToolContext)) as {
      content: Array<{ type: string; text?: string }>
      details: unknown
    }

    expect(output.content).toHaveLength(1)
    expect(output.content[0]!.type).toBe('text')
    const parsed = JSON.parse(output.content[0]!.text!)
    expect(parsed.version).toBe('2.5')
    expect(parsed.ok).toBe(true)
    expect(parsed.data.complete).toBe(false)
    expect(parsed.data.snapshot_id).toBe('snap-1')
    expect(output.details).toEqual(mockEnvelope)
  })

  test('Given screenshot 命令包含图像 When 执行 Then 同时返回 text 与 image content', async () => {
    const mockEnvelope: AgentDesktopEnvelope = {
      version: '2.5',
      ok: true,
      command: 'screenshot',
      data: {
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=',
        format: 'png',
        width: 1,
        height: 1,
      },
    }

    const mockController = {
      execute: async () => mockEnvelope,
    } as unknown as ComputerController

    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController)[0]!
    const output = (await tool.execute('call-2', { command: 'screenshot' }, undefined, undefined, {} as ExtensionToolContext)) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
      details: unknown
    }

    expect(output.content).toHaveLength(2)
    expect(output.content[0]!.type).toBe('text')
    expect(output.content[1]!.type).toBe('image')
    expect(output.content[1]!.mimeType).toBe('image/png')
    expect(output.content[0]!.text).not.toContain((mockEnvelope.data as { data: string }).data)
    expect(JSON.parse(output.content[0]!.text!)).toEqual({ ...mockEnvelope, data: { format: 'png', width: 1, height: 1 } })
    expect(output.details).toBe(mockEnvelope)
    expect(output.content[1]!.data).toBe(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=',
    )
  })

  test('Given find、wait、mouse-click 的 count When 校验工具 schema Then 同时暴露布尔开关与数值计数', () => {
    const tool = buildPiComputerTools(mockSdk, binding, 'user', {} as ComputerController)[0]!
    for (const input of [{ command: 'find', count: true }, { command: 'wait', count: 2 }, { command: 'mouse-click', count: 2 }]) {
      expect(Value.Check(tool.parameters, input)).toBe(true)
    }
    expect(Value.Check(tool.parameters, { command: 'find', count: 'true' })).toBe(false)
  })

  test('Given 截图工具结果 When 压缩历史截图 Then 文本不遗留 base64 且原始 details 保持不变', async () => {
    const envelope: AgentDesktopEnvelope = {
      version: '2.5', ok: true, command: 'screenshot',
      data: { data: 'UNIQUE_SCREENSHOT_BASE64', format: 'png', width: 10, height: 20 },
    }
    const original = JSON.stringify(envelope)
    const controller = { execute: async () => envelope } as unknown as ComputerController
    const tool = buildPiComputerTools(mockSdk, binding, 'user', controller)[0]!
    const output = await tool.execute('screenshot-call', { command: 'screenshot' }, undefined, undefined, {} as ExtensionToolContext)
    const messages: AgentMessage[] = [{
      role: 'toolResult', toolCallId: 'screenshot-call', toolName: 'computer', timestamp: 1,
      isError: false, content: output.content,
    }]
    const compacted = compactComputerScreenshots(messages, 0)
    expect(JSON.stringify(compacted)).not.toContain('UNIQUE_SCREENSHOT_BASE64')
    expect(JSON.stringify(messages)).toContain('UNIQUE_SCREENSHOT_BASE64')
    expect(output.details).toBe(envelope)
    expect(JSON.stringify(envelope)).toBe(original)
  })

  test('Given 运行已暂停或中断 When 执行 Then 返回结构化错误与 interrupted 标识', async () => {
    const mockController = {
      execute: async () => {
        throw new ComputerRunPausedError('用户在应用内点击停止')
      },
    } as unknown as ComputerController

    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController)[0]!
    const output = (await tool.execute('call-3', { command: 'click', ref: '@s1:e1' }, undefined, undefined, {} as ExtensionToolContext)) as {
      content: Array<{ type: string; text?: string }>
      details: { interrupted?: boolean; reason?: string }
    }

    expect(output.details.interrupted).toBe(true)
    expect(output.details.reason).toBe('用户在应用内点击停止')
    const parsed = JSON.parse(output.content[0]!.text!)
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('COMPUTER_RUN_PAUSED')
  })
})
