import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import { buildPiComputerTools } from './pi-computer-tools'
import type { ComputerController } from '../computer-controller'
import type { AgentDesktopEnvelope } from '../agent-desktop-protocol'
import { ComputerRunPausedError } from '../computer-pause'

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
    const output = (await (tool.execute as any)('call-1', { command: 'snapshot', app: 'Notes' }, undefined)) as {
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
    const output = (await (tool.execute as any)('call-2', { command: 'screenshot' }, undefined)) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    }

    expect(output.content).toHaveLength(2)
    expect(output.content[0]!.type).toBe('text')
    expect(output.content[1]!.type).toBe('image')
    expect(output.content[1]!.mimeType).toBe('image/png')
    expect(output.content[1]!.data).toBe(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=',
    )
  })

  test('Given 运行已暂停或中断 When 执行 Then 返回结构化错误与 interrupted 标识', async () => {
    const mockController = {
      execute: async () => {
        throw new ComputerRunPausedError('用户在应用内点击停止')
      },
    } as unknown as ComputerController

    const tool = buildPiComputerTools(mockSdk, binding, 'user', mockController)[0]!
    const output = (await (tool.execute as any)('call-3', { command: 'click', ref: '@s1:e1' }, undefined)) as {
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
