import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'

describe('Given 存在应用拒绝规则的原生目标门禁', () => {
  test('When 只拒绝 bundle ID，使用显示名、引用或窗口请求同一应用 Then 均不能投递', async () => {
    for (const input of [
      { command: 'snapshot', app: 'Notes' },
      { command: 'click', ref: '@snapshot:e1' },
      { command: 'focus-window', windowId: '12' },
    ]) {
      const f = createComputerFixture()
      f.auth.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
      await expect(f.controller.execute(f.binding, input)).rejects.toThrow('拒绝')
      expect(f.calls.some(call => call.method === input.command)).toBe(false)
      await f.controller.finishRun(f.binding)
    }
  })
  test('When 引用真实归属与模型自报 app 不同 Then 不以自报 app 绕过拒绝', async () => {
    const f = createComputerFixture()
    f.auth.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
    // snapshot --root 在上游按 ref 寻址，app 字段不能成为绕过目标身份的凭证。
    await expect(f.controller.execute(f.binding, { command: 'snapshot', root: '@snapshot:e1', app: 'Safari' })).rejects.toThrow('实际目标')
    expect(f.calls.some(call => call.method === 'snapshot')).toBe(false)
    await f.controller.finishRun(f.binding)
  })
  test('When 无法定位全屏、物理输入、全局快捷键、跨应用 surface Then 明确阻断而非返回伪成功', async () => {
    for (const input of [
      { command: 'screenshot' },
      { command: 'press', combo: 'Tab' },
      { command: 'mouse-click', xy: '10,20', headed: true },
      { command: 'snapshot', app: 'Safari', surface: 'menubar' },
    ]) {
      const f = createComputerFixture()
      f.auth.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
      await expect(f.controller.execute(f.binding, input)).rejects.toThrow('实际目标')
      expect(f.actions).toHaveLength(0)
      await f.controller.finishRun(f.binding)
    }
  })
  test('When 操作已允许的显式应用 Then 原生参数使用规范 bundle ID，不误阻断其他应用', async () => {
    const f = createComputerFixture()
    f.auth.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
    await expect(f.controller.execute(f.binding, { command: 'snapshot', app: 'Safari' })).resolves.toMatchObject({ ok: true })
    expect(f.calls.at(-1)?.params.args).toContain('--app=com.apple.Safari')
    await f.controller.finishRun(f.binding)
  })
  test('When 引用归属允许且原生实例匹配 Then 允许语义操作；伪造引用则拒绝', async () => {
    const f = createComputerFixture()
    f.auth.recordAppDecision('Safari', 'denied', 'com.apple.Safari')
    await expect(f.controller.execute(f.binding, { command: 'click', ref: '@snapshot:e1' })).resolves.toMatchObject({ ok: true })
    const count = f.actions.length
    await expect(f.controller.execute(f.binding, { command: 'click', ref: '@foreign:e1' })).rejects.toThrow('引用')
    expect(f.actions).toHaveLength(count)
    await f.controller.finishRun(f.binding)
  })
  test('When 引用进程实例已经更换 Then 拒绝复用旧 pid 的授权', async () => {
    const f = createComputerFixture({ call: async method => method === 'list-apps' ? { apps: [{ name: 'Notes', pid: 34, bundle_id: 'com.apple.Notes', process_instance: 'reused-pid' }] } : undefined })
    f.auth.recordAppDecision('Safari', 'denied', 'com.apple.Safari')
    await expect(f.controller.execute(f.binding, { command: 'click', ref: '@snapshot:e1' })).rejects.toThrow('实际目标')
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 宽松且无任何应用拒绝 Then 不为每次动作增加库存查询', async () => {
    const f = createComputerFixture({ policy: 'relaxed' })
    await f.controller.execute(f.binding, { command: 'press', combo: 'Tab' })
    expect(f.calls.map(call => call.method)).toEqual(['press'])
    await f.controller.finishRun(f.binding)
  })
})

test('Given 被拒绝应用的限定引用 When wait element 带伪报 app 或不带 app Then 不按自报 app 授权', async () => {
  for (const app of [undefined, 'Safari']) {
    const f = createComputerFixture()
    f.auth.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
    await expect(f.controller.execute(f.binding, { command: 'wait', element: '@snapshot:e1', ...(app ? { app } : {}) })).rejects.toThrow()
    expect(f.calls.some(call => call.method === 'wait')).toBe(false)
    await f.controller.finishRun(f.binding)
  }
})

test('Given Safari 尚未运行且 Notes 被拒绝 When 安装身份可信 Then 仍可启动 Safari，不能借别名启动 Notes', async () => {
  for (const bundleId of ['com.apple.Safari', 'com.apple.Notes']) {
    const f = createComputerFixture({ installedApp: { appName: bundleId === 'com.apple.Safari' ? 'Safari' : 'Notes', bundleId },
      call: async method => method === 'list-apps' ? { apps: [] } : undefined })
    f.auth.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
    if (bundleId === 'com.apple.Safari') {
      await expect(f.controller.execute(f.binding, { command: 'launch', app: 'Safari' })).resolves.toMatchObject({ ok: true })
      expect(f.calls.at(-1)?.params.args).toContain('com.apple.Safari')
    } else {
      await expect(f.controller.execute(f.binding, { command: 'launch', app: 'Safari' })).rejects.toThrow('拒绝')
      expect(f.actions).toHaveLength(0)
    }
    await f.controller.finishRun(f.binding)
  }
})
