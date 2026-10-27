import { describe, expect, test } from 'bun:test'
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, normalizeContext, type Model } from '@earendil-works/pi-ai'
import type { ComputerPrivateObservation } from '@gamma/shared'
import { compactComputerScreenshots, injectComputerObservationContext, stripComputerObservationContent, withComputerRequestFence, withComputerSharingFence } from './pi-computer-context'
const observation: ComputerPrivateObservation = { observationId: 'opaque-id', epoch: 1, image: { data: 'IMAGE_PRIVATE_CANARY', mimeType: 'image/png', width: 1, height: 1 }, ax: 'AX_PRIVATE_CANARY' }
describe('Given 桌面观察请求前临时注入', () => {
  test('When 观察已注入但auth等待期间撤权 Then 最终payload门禁拒绝外发', async () => {
    let resume!: () => void, entered!: () => void, revoked = false, sent = false
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const barrier = new Promise<void>(resolve => { resume = resolve })
    const fenced = withComputerRequestFence(async (model, context, options) => {
      entered(); await barrier // 模拟provider内部认证/请求扩展的异步等待
      await options?.onPayload?.({ messages: context.messages }, model)
      sent = true
      const stream = createAssistantMessageEventStream(); stream.end(); return stream
    }, async () => { if (revoked) throw new Error('租约已撤销') })
    const model: Model<'openai-responses'> = { id: 'fixture', name: 'fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://invalid.local', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 }
    const pending = fenced(model, normalizeContext({ messages: [{ role: 'user', content: [{ type: 'text', text: 'AX_PRIVATE_CANARY' }], timestamp: 1 }] }), {})
    await waiting; revoked = true; resume()
    await expect(Promise.resolve(pending)).rejects.toThrow('租约已撤销')
    expect(sent).toBe(false)
  })

  test('When 生成provider副本 Then 原始消息与恢复/压缩输入不含观察', () => {
    const original: AgentMessage[] = [{ role: 'user', content: '测试任务', timestamp: 1 }]
    const persisted = JSON.stringify(original)
    const request = injectComputerObservationContext(original, [observation])
    expect(JSON.stringify(request)).toContain('IMAGE_PRIVATE_CANARY')
    expect(JSON.stringify(request)).toContain('AX_PRIVATE_CANARY')
    expect(JSON.stringify(original)).toBe(persisted)
    expect(injectComputerObservationContext(original, [])).toEqual(original)
    expect(JSON.stringify(injectComputerObservationContext(JSON.parse(persisted), []))).not.toContain('PRIVATE_CANARY')
  })
  test('When 请求取消 Then 不再注入原图', () => {
    const aborted = new AbortController(); aborted.abort()
    expect(() => injectComputerObservationContext([], [observation], aborted.signal)).toThrow()
  })
  test('When 仅有 AX 且没有截图或图像尺寸 Then 只注入文本，并保留观察绑定与不可信边界', () => {
    const axOnly: ComputerPrivateObservation = { observationId: 'ax-only-id', epoch: 3, ax: 'AX_ONLY_PRIVATE_CANARY' }
    const original: AgentMessage[] = [{ role: 'user', content: '编辑正文', timestamp: 1 }]
    const before = JSON.stringify(original)
    const request = injectComputerObservationContext(original, [observation, axOnly])
    const temporary = request.at(-1)
    if (temporary?.role !== 'user' || typeof temporary.content === 'string') throw new Error('缺少请求前临时观察')
    expect(temporary.content).toHaveLength(1)
    expect(temporary.content[0]?.type).toBe('text')
    const text = JSON.stringify(temporary.content)
    expect(text).toContain('AX_ONLY_PRIVATE_CANARY')
    expect(text).toContain('ax-only-id')
    expect(text).toContain('没有截图')
    expect(text).toContain('元素引用或快捷键')
    expect(text).toContain('<untrusted_desktop_ax>')
    expect(text).not.toContain('IMAGE_PRIVATE_CANARY')
    expect(text).not.toContain('逐次批准')
    expect(text).not.toContain('undefined')
    expect(JSON.stringify(original)).toBe(before)
    const aborted = new AbortController(); aborted.abort()
    expect(() => injectComputerObservationContext(original, [axOnly], aborted.signal)).toThrow('取消')
  })

  test('When AX-only 工具结果的外发同意已撤销 Then 无图也受请求门禁保护并可剥离历史观察', async () => {
    const messages = [{ role: 'toolResult', toolName: 'computer', toolCallId: 'ax-call', isError: false, timestamp: 1, content: [{ type: 'text', text: 'AX_ONLY_PRIVATE_CANARY' }] }] satisfies AgentMessage[]
    let sent = false
    const fenced = withComputerSharingFence(() => {
      sent = true
      const stream = createAssistantMessageEventStream(); stream.end(); return stream
    }, async () => { throw new Error('外发同意已撤销') })
    const model: Model<'openai-responses'> = { id: 'fixture', name: 'fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://invalid.local', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 }
    await expect(Promise.resolve(fenced(model, normalizeContext({ messages }), {}))).rejects.toThrow('外发同意已撤销')
    expect(sent).toBe(false)
    expect(JSON.stringify(stripComputerObservationContent(messages))).not.toContain('AX_ONLY_PRIVATE_CANARY')
    expect(JSON.stringify(messages)).toContain('AX_ONLY_PRIVATE_CANARY')
  })
  test('When 真正Pi Agent执行请求变换 Then canary只进入模拟provider，不进入agent历史/事件', async () => {
    let provider = ''
    const events: unknown[] = []
    const agent = new Agent({
      initialState: { model: { id: 'fixture', name: 'fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://invalid.local', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 } },
      transformContext: async (messages, signal) => injectComputerObservationContext(messages, [observation], signal),
      streamFn: (_model, context) => {
        provider = JSON.stringify(context.messages)
        const stream = createAssistantMessageEventStream()
        stream.push({ type: 'done', reason: 'stop', message: {
          role: 'assistant', content: [{ type: 'text', text: 'fixture完成' }], api: 'openai-responses', provider: 'openai', model: 'fixture',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2,
        } }); stream.end(); return stream
      },
    })
    agent.subscribe(event => { events.push(event) })
    await agent.prompt('只运行本地模拟provider，不调用网络')
    expect(provider).toContain('IMAGE_PRIVATE_CANARY')
    expect(provider).toContain('AX_PRIVATE_CANARY')
    expect(JSON.stringify(agent.state.messages)).not.toContain('PRIVATE_CANARY')
    expect(JSON.stringify(events)).not.toContain('PRIVATE_CANARY')
  })

  test('When 历史消息中有多张截图 Then 仅保留最近的2张截图并紧凑替换较早的截图', () => {
    const messages: AgentMessage[] = [
      {
        role: 'user', timestamp: 1,
        content: [{ type: 'image', data: 'SCREENSHOT_1', mimeType: 'image/png' }],
      },
      {
        role: 'assistant', timestamp: 2,
        content: [{ type: 'text', text: '正在点击' }],
        api: 'anthropic-messages', provider: 'anthropic', model: 'claude-3-7-sonnet',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
      },
      {
        role: 'toolResult', timestamp: 3,
        toolCallId: 'call_1', toolName: 'computer', isError: false,
        content: [
          { type: 'text', text: '点击完成' },
          { type: 'image', data: 'SCREENSHOT_2', mimeType: 'image/png' },
        ],
      },
      {
        role: 'toolResult', timestamp: 4,
        toolCallId: 'call_2', toolName: 'computer', isError: false,
        content: [
          { type: 'text', text: '输入完成' },
          { type: 'image', data: 'SCREENSHOT_3', mimeType: 'image/png' },
        ],
      },
      {
        role: 'toolResult', timestamp: 5,
        toolCallId: 'call_3', toolName: 'computer', isError: false,
        content: [
          { type: 'text', text: '快捷键完成' },
          { type: 'image', data: 'SCREENSHOT_4', mimeType: 'image/png' },
        ],
      },
    ]

    const compacted = compactComputerScreenshots(messages, 2)
    const json = JSON.stringify(compacted)

    // 用户附件保持原样，只删除最早的 computer 截图。
    expect(json).toContain('SCREENSHOT_1')
    expect(JSON.stringify(messages)).toContain('SCREENSHOT_2')
    expect(json).not.toContain('SCREENSHOT_2')
    // 最近的两张截图 (3, 4) 完整保留
    expect(json).toContain('SCREENSHOT_3')
    expect(json).toContain('SCREENSHOT_4')
    expect(json).toContain('[历史屏幕截图已省略以节约上下文]')
  })
})


test('Given 用户、read、browser 图片与多张桌面截图 When 压缩 Then 仅清理桌面截图且不修改原消息', () => {
  const images: AgentMessage[] = [1, 2, 3].map(timestamp => ({ role: 'user', timestamp, content: [{ type: 'image', data: `USER_${timestamp}`, mimeType: 'image/png' }] }))
  for (const toolName of ['read', 'BrowserScreenshot', 'computer', 'computer', 'computer']) images.push({ role: 'toolResult', toolName, timestamp: images.length, toolCallId: String(images.length), isError: false, content: [{ type: 'image', data: `${toolName}_${images.length}`, mimeType: 'image/png' }] })
  const original = JSON.stringify(images)
  const compact = JSON.stringify(compactComputerScreenshots(images))
  for (const data of ['USER_1', 'USER_2', 'USER_3', 'read_3', 'BrowserScreenshot_4', 'computer_6', 'computer_7']) expect(compact).toContain(data)
  expect(compact).not.toContain('computer_5')
  expect(JSON.stringify(images)).toBe(original)
})
