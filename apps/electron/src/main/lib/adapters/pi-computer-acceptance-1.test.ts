import { describe, expect, test } from 'bun:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createComputerToolsFixture } from '../../../test-utils/computer-tools-fixture'
import { compactComputerScreenshots } from './pi-computer-context'

describe('Given Notes 验收的注册工具合成宿主回归（非真实桌面E2E）', () => {
  test('When 已完成首次授权后由模型连续调用 Then open_app → cmd+n → type 每步返回新截图，无确认', async () => {
    const f = createComputerToolsFixture()
    f.auth.setUiHandlers({ appAuth: async () => { throw new Error('不应重新要求应用授权') }, riskConfirm: async () => { throw new Error('低风险不应确认') } })
    expect(f.tools.map(tool => tool.name)).toEqual(['computer', 'ComputerStatus', 'ComputerStop'])
    for (const params of [{ action: 'open_app', app: 'Notes' }, { action: 'key', key: 'cmd+n' }, { action: 'type', text: '测试' }]) {
      const result = await f.execute(params)
      expect(result.content.some(block => block.type === 'image')).toBe(true)
      expect(result.content.some(block => block.type === 'text' && block.text.includes('请根据最新界面状态验证业务结果'))).toBe(true)
    }
    expect(f.actions.map(action => action.kind)).toEqual(['open_app', 'key', 'type'])
    expect(f.actions[0]?.bundleId).toBe('com.apple.Notes')
    expect(f.actions[2]?.text).toBe('测试')
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
