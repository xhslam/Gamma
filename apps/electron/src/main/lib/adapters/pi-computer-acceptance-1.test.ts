import { describe, expect, test } from 'bun:test'
import type { AgentDesktopInput } from '../agent-desktop-protocol'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createComputerToolsFixture } from '../../../test-utils/computer-tools-fixture'
import { compactComputerScreenshots } from './pi-computer-context'

describe('Given Notes 验收的注册工具合成宿主回归（非真实桌面E2E）', () => {
  test('When 已完成首次授权后由模型连续调用 Then launch → press → type 每步返回结构化结果，无重复确认', async () => {
    const f = createComputerToolsFixture({ policy: 'standard' })
    f.auth.setUiHandlers({ appAuth: async () => { throw new Error('不应重新要求应用授权') }, riskConfirm: async () => { throw new Error('低风险不应确认') } })
    expect(f.tools.map(tool => tool.name)).toEqual(['computer'])
    for (const params of [{ command: 'launch', app: 'Notes' }, { command: 'press', combo: 'cmd+n', app: 'Notes' }, { command: 'type', ref: '@snapshot:e1', text: '测试' }]) {
      const result = await f.execute(params as AgentDesktopInput)
      const textBlock = result.content.find((block): block is { type: 'text'; text: string } => block.type === 'text')
      expect(textBlock).toBeDefined()
      const parsed = JSON.parse(textBlock!.text)
      expect(parsed.ok).toBe(true)
    }
    expect(f.actions.map(action => action.kind)).toEqual(['launch', 'press', 'type'])
    expect(f.actions[0]?.args).toContain('com.apple.Notes')
    expect(f.actions[2]?.args).toContain('测试')
    expect(f.calls.some(call => call.method === 'confirmation')).toBe(false)
    await f.controller.finishRun(f.binding)
  })
  test('When 连续computer截图进入上下文 Then 仅保留最新两张', () => {
    const messages: AgentMessage[] = [1, 2, 3].map(index => ({ role: 'toolResult', timestamp: index, toolCallId: `call${index}`, toolName: 'computer', isError: false, content: [{ type: 'image', data: `SCREENSHOT_${index}`, mimeType: 'image/png' }] }))
    const compacted = JSON.stringify(compactComputerScreenshots(messages, 2))
    expect(compacted).not.toContain('SCREENSHOT_1')
    expect(compacted).toContain('SCREENSHOT_2')
    expect(compacted).toContain('SCREENSHOT_3')
  })
})
