import { describe, expect, test } from 'bun:test'
import type { AgentDesktopInput } from '../agent-desktop-protocol'
import { createComputerToolsFixture } from '../../../test-utils/computer-tools-fixture'

describe('Given Safari 天气搜索的注册工具合成宿主回归（非真实网页/桌面E2E）', () => {
  test('When 已授权Safari后通过工具循环搜索 Then 地址栏输入和回车无需确认', async () => {
    const f = createComputerToolsFixture({ policy: 'standard' })
    let confirmations = 0
    f.auth.setUiHandlers({ appAuth: async () => { confirmations++; return 'always' }, riskConfirm: async () => { confirmations++; return false } })
    for (const params of [
      { command: 'launch', app: 'Safari' },
      { command: 'press', combo: 'cmd+l', app: 'Safari' },
      { command: 'type', ref: '@snapshot:e2', text: '今天的天气' },
      { command: 'press', combo: 'Return', app: 'Safari' },
      { command: 'screenshot', app: 'Safari' },
    ]) {
      const result = await f.execute(params as AgentDesktopInput)
      const text = result.content.find(block => block.type === 'text')
      expect(text?.type === 'text' && JSON.parse(text.text).ok).toBe(true)
    }
    expect(f.actions.map(action => action.kind)).toEqual(['launch', 'press', 'type', 'press'])
    expect(f.actions[0]?.args).toContain('com.apple.Safari')
    expect(confirmations).toBe(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 首次操作Safari Then 只问应用授权，后续按bundle记忆，不冒充完整任务验收', async () => {
    const f = createComputerToolsFixture({ trustedApps: false, policy: 'standard' })
    let prompts = 0
    f.auth.setUiHandlers({ appAuth: async () => { prompts++; return 'always' } })
    await f.execute({ command: 'launch', app: 'Safari' })
    await f.execute({ command: 'type', ref: '@snapshot:e2', text: '今天的天气' })
    await f.execute({ command: 'press', combo: 'Return', app: 'Safari' })
    expect(prompts).toBe(1)
    expect(f.auth.checkAppAuthorization('Safari', 'com.apple.Safari')).toBe('allowed')
    await f.controller.finishRun(f.binding)
  })
})
