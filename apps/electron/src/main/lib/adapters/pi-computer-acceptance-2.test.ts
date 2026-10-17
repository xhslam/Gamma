import { describe, expect, test } from 'bun:test'
import { createComputerToolsFixture } from '../../../test-utils/computer-tools-fixture'

describe('Given Safari 天气搜索的注册工具合成宿主回归（非真实网页/桌面E2E）', () => {
  test('When 已授权Safari后通过工具循环搜索 Then 地址栏输入和回车无需确认', async () => {
    const f = createComputerToolsFixture()
    let confirmations = 0
    f.auth.setUiHandlers({ appAuth: async () => { confirmations++; return 'always' }, riskConfirm: async () => { confirmations++; return false } })
    for (const params of [{ action: 'open_app', app: 'Safari' }, { action: 'key', key: 'cmd+l' }, { action: 'type', text: '今天的天气' }, { action: 'key', key: 'Return' }, { action: 'screenshot' }]) {
      const result = await f.execute(params)
      expect(result.content.some(block => block.type === 'image')).toBe(true)
    }
    expect(f.actions.map(action => action.kind)).toEqual(['open_app', 'key', 'type', 'key'])
    expect(f.actions[0]?.bundleId).toBe('com.apple.Safari')
    expect(confirmations).toBe(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 首次操作Safari Then 只问应用授权，后续按bundle记忆，不冒充完整任务验收', async () => {
    const f = createComputerToolsFixture({ trustedApps: false })
    let prompts = 0
    f.auth.setUiHandlers({ appAuth: async () => { prompts++; return 'always' } })
    await f.execute({ action: 'open_app', app: 'Safari' })
    await f.execute({ action: 'type', text: '今天的天气' })
    await f.execute({ action: 'key', key: 'Return' })
    expect(prompts).toBe(1)
    expect(f.auth.checkAppAuthorization('Safari', 'com.apple.Safari')).toBe('allowed')
    await f.controller.finishRun(f.binding)
  })
})
