import { describe, expect, test } from 'bun:test'
import { Agent } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { computerPermissionInterruption, installComputerInterruptionHooks } from './pi-computer-context'
import { convertComputerInterruptionNotice, convertResultMessage } from './pi-message-adapter'
import { computerPausedToolMessage } from '../computer-pause'
import { PiAgentAdapter } from './pi-agent-adapter'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@gamma/shared'

describe('Given Pi 真正工具执行循环发生电脑安全暂停', () => {
  test('When 同批次还有工具 Then 后续工具不执行、不再请求模型、终态不得报告成功', async () => {
    let requests = 0
    let laterCalls = 0
    const agent = new Agent({
      toolExecution: 'sequential',
      initialState: {
        model: { id: 'fixture', name: 'fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://invalid.local', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 },
        tools: [{ name: 'computer', label: '电脑', description: '测试', parameters: Type.Object({}), execute: async () => ({ content: [{ type: 'text' as const, text: '电脑操作已暂停' }], details: { interrupted: true }, isError: true, terminate: true }) },
          { name: 'later', label: '后续动作', description: '不应执行', parameters: Type.Object({}), execute: async () => { laterCalls++; return { content: [], details: {} } } }],
      },
      streamFn: () => {
        requests++
        const stream = createAssistantMessageEventStream()
        stream.push({ type: 'done', reason: 'toolUse', message: {
          role: 'assistant', content: [{ type: 'toolCall', id: 'computer-1', name: 'computer', arguments: {} }, { type: 'toolCall', id: 'later-1', name: 'later', arguments: {} }], api: 'openai-responses', provider: 'openai', model: 'fixture',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 2,
        } })
        stream.end()
        return stream
      },
    })
    installComputerInterruptionHooks(agent)
    await agent.prompt('只运行模拟provider，不调用网络或桌面')
    expect(requests).toBe(1)
    expect(laterCalls).toBe(0)
    const results = agent.state.messages.filter(message => message.role === 'toolResult')
    expect(results).toHaveLength(2)
    expect(results.every(message => message.isError)).toBe(true)
    expect(convertResultMessage(agent.state.messages, 'fixture')).toMatchObject({ subtype: 'error_during_execution', terminal_reason: 'computer_interrupted' })
    expect(JSON.stringify(convertComputerInterruptionNotice(agent.state.messages, 'fixture'))).toContain('本轮任务尚未确认完成')
  })

  test('When 非电脑工具或普通权限拒绝 Then 不误判为电脑安全暂停', () => {
    expect(computerPermissionInterruption('computer', '用户未批准本次操作')).toBeUndefined()
    expect(computerPermissionInterruption('Bash', computerPausedToolMessage('物理接管'))).toBeUndefined()
    expect(computerPermissionInterruption('computer', `外部文本：${computerPausedToolMessage('物理接管')}`)).toBeUndefined()
    expect(convertComputerInterruptionNotice([], 'fixture')).toBeUndefined()
  })

  test('When 真实适配器的权限门禁先拒绝computer Then 不执行工具、不再请求模型且留下持久化暂停说明', async () => {
    let requests = 0
    let executions = 0
    const root = mkdtempSync(join(tmpdir(), 'gamma-computer-gate-'))
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => {
      requests++
      const delta = requests === 1
        ? { tool_calls: [{ index: 0, id: 'gate-computer-1', type: 'function', function: { name: 'computer', arguments: '{}' } }] }
        : { content: '暂停后不应再请求本条模型回复' }
      const frame = (part: object, reason: string | null): string => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4o-mini', choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`
      return new Response(`${frame(delta, null)}${frame({}, requests === 1 ? 'tool_calls' : 'stop')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    const adapter = new PiAgentAdapter()
    const messages: SDKMessage[] = []
    try {
      for await (const message of adapter.query({
        sessionId: 'computer-gate-fixture', prompt: '只运行本地模拟工具，不操作桌面', model: 'gpt-4o-mini',
        systemPrompt: '执行电脑工具安全门禁测试。',
        provider: 'openai', baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: 'fixture-only',
        cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'), permissionMode: 'bypassPermissions',
        canUseTool: async () => ({ behavior: 'deny', message: computerPausedToolMessage('检测到用户操作，桌面控制已暂停') }),
        customTools: [{ name: 'computer', label: '模拟电脑', description: '不调用系统桌面', parameters: Type.Object({}), execute: async () => { executions++; return { content: [], details: {} } } }],
      })) messages.push(message)
      expect(requests).toBe(1)
      expect(executions).toBe(0)
      expect(messages.find(message => message.type === 'result')).toMatchObject({ subtype: 'error_during_execution', terminal_reason: 'computer_interrupted' })
      const notices = messages.filter(message => message.type === 'assistant' && JSON.stringify(message).includes('本轮任务尚未确认完成'))
      expect(notices).toHaveLength(1)
      expect(JSON.stringify(notices)).toContain('检测到用户操作')
    } finally { adapter.dispose(); await server.stop(true); rmSync(root, { recursive: true, force: true }) }
  })
})
