import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'

const screenshot = { action: 'screenshot' }
describe('Given 与其他工具平级的按需 Computer Use', () => {
  test('When 用户直接调用 screenshot Then 无模式授权/选窗，绑定真实运行并返回截图', async () => {
    const f = createComputerFixture()
    const result = await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    expect(result.image.width).toBe(1)
    expect(f.controller.getState().sessionId).toBe(f.binding.sessionId)
    expect(f.controller.isDesktopRun(f.binding)).toBe(true)
    for (const name of ['Bash', 'read', 'mcp__service__read', 'computer']) expect(() => f.controller.assertTool(f.binding, name)).not.toThrow()
    await f.controller.finishRun(f.binding)
  })
  test('When 本轮结束再发新任务 Then 不要求重新启用且不阻断普通运行', async () => {
    const f = createComputerFixture()
    await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    const release = f.controller.reserveRun('other-file-session'); release()
    const other = { ...f.binding, sessionId: 'other', runId: 'other' }
    expect(() => f.controller.beginRun(other, 'user', true)).not.toThrow()
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, other)).rejects.toThrow('另一个运行')
    await f.controller.finishRun(other)
    await f.controller.finishRun(f.binding)
    const next = { ...f.binding, runId: 'run-2' }
    f.controller.beginRun(next, 'user', true)
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, next)).resolves.toHaveProperty('image')
    await f.controller.finishRun(next)
  })
  test('When 用户停止后同轮重试 Then 拒绝；下一条用户消息才可开始新动作', async () => {
    const f = createComputerFixture()
    await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    let revoked = false
    f.controller.onRevoked(f.binding, () => { revoked = true })
    await f.controller.stop('用户接管', 'paused')
    expect(revoked).toBe(true)
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, f.binding)).rejects.toThrow('本轮')
    await f.controller.finishRun(f.binding)
    const next = { ...f.binding, runId: 'next-user-message' }
    f.controller.beginRun(next, 'user', true)
    await f.controller.executeAutonomousAction(screenshot, undefined, next)
    expect(f.calls.filter(call => call.method === 'perform')).toHaveLength(0)
    await f.controller.finishRun(next)
  })
  test('When 短期租约自然到期 Then 透明重连，不要求点按钮', async () => {
    const f = createComputerFixture()
    await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    f.advance(31 * 60_000)
    await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    expect(f.calls.filter(call => call.method === 'select')).toHaveLength(2)
    expect(f.controller.getState().resumeRequired).toBe(false)
    await f.controller.finishRun(f.binding)
  })
  test('When 后台来源、未知视觉或伪造绑定 Then 不启动 helper', async () => {
    for (const options of [{ source: 'automation' }, { source: 'delegation' }, { vision: false }]) {
      const f = createComputerFixture(options)
      await expect(f.controller.executeAutonomousAction(screenshot, undefined, f.binding)).rejects.toThrow()
      expect(f.calls).toHaveLength(0)
    }
    const f = createComputerFixture()
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, { ...f.binding, runId: 'forged' })).rejects.toThrow('有效运行')
    expect(f.calls).toHaveLength(0)
  })
  test('When 用户拒绝外发同意 Then 不读取桌面或启动应用', async () => {
    const f = createComputerFixture({ consent: false })
    f.auth.setUiHandlers({ observationConsent: async () => false })
    await expect(f.controller.executeAutonomousAction({ action: 'open_app', app: 'Notes' }, undefined, f.binding)).rejects.toThrow('尚未同意')
    expect(f.calls).toHaveLength(0)
  })
  test('When 授权尚未结束又调用电脑工具 Then 不能并发启动动作', async () => {
    const f = createComputerFixture({ consent: false })
    let approve!: (value: boolean) => void
    f.auth.setUiHandlers({ observationConsent: () => new Promise(resolve => { approve = resolve }) })
    const first = f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, f.binding)).rejects.toThrow('在途')
    approve(true); await first; await f.controller.finishRun(f.binding)
  })
  test('When 应用授权期间停止 Then 迟到批准既不投递也不记录', async () => {
    const f = createComputerFixture({ trustedApps: false })
    let approve!: (value: 'always') => void
    let requested!: () => void
    const waiting = new Promise<void>(resolve => { requested = resolve })
    f.auth.setUiHandlers({ appAuth: () => { requested(); return new Promise(resolve => { approve = resolve }) } })
    const first = f.controller.executeAutonomousAction({ action: 'open_app', app: 'Notes' }, undefined, f.binding)
    await waiting; await f.controller.stop('用户停止')
    approve('always')
    await expect(first).rejects.toThrow('停止')
    expect(f.auth.checkAppAuthorization('Notes', 'com.apple.Notes', f.binding.runId)).toBe('pending')
    expect(f.calls.some(call => call.method === 'perform')).toBe(false)
  })
  test('When 原生回执错误或拒绝 Then 不宣称执行成功且不自动重放', async () => {
    for (const outcome of ['rejected', 'outcome-unknown', 'wrong-id']) {
      const f = createComputerFixture({ call: async (method, params) => method === 'perform' ? { actionId: outcome === 'wrong-id' ? 'wrong' : params.actionId, outcome: outcome === 'wrong-id' ? 'dispatched-unverified' : outcome } : undefined })
      await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'cmd+n' }, undefined, f.binding)).rejects.toThrow()
      expect(f.calls.filter(call => call.method === 'perform')).toHaveLength(1)
      await f.controller.finishRun(f.binding)
    }
  })
  test('When 实际目标是未授权应用 Then 按真实 bundle 授权，不采用 text 伪装应用名', async () => {
    const f = createComputerFixture({ trustedApps: false })
    let app = ''
    f.auth.setUiHandlers({ appAuth: async req => { app = req.bundleId!; return 'once' } })
    await f.controller.executeAutonomousAction({ action: 'type', text: 'Safari' }, undefined, f.binding)
    expect(app).toBe('com.apple.Notes')
    expect(f.actions[0]?.appName).toBeUndefined()
    expect(f.calls.filter(call => call.method === 'confirmation').map(call => call.params.waiting)).toEqual([true, false])
    await f.controller.finishRun(f.binding)
    expect(f.auth.checkAppAuthorization('Notes', 'com.apple.Notes', f.binding.runId)).toBe('pending')
  })
  test('When 点击、拖拽或等待参数无效 Then 不截断坐标，也不投递动作', async () => {
    const f = createComputerFixture()
    for (const action of [{ action: 'click', x: -1, y: 0 }, { action: 'click', x: 1, y: 0 }, { action: 'drag', x: 0, y: 0 }, { action: 'wait', duration: Number.NaN }, { action: 'wait', duration: 11 }]) await expect(f.controller.executeAutonomousAction(action, undefined, f.binding)).rejects.toThrow()
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 调用列窗、聚焦、组合键和拖拽 Then 使用新协议并返回新截图', async () => {
    const f = createComputerFixture()
    const listed = await f.controller.executeAutonomousAction({ action: 'list_windows' }, undefined, f.binding)
    expect(listed.windows?.[0]?.windowId).toBe(12)
    await f.controller.executeAutonomousAction({ action: 'focus_window', windowId: 12 }, undefined, f.binding)
    const keyed = await f.controller.executeAutonomousAction({ action: 'key', key: 'cmd+shift+n' }, undefined, f.binding)
    await f.controller.executeAutonomousAction({ action: 'drag', coordinate: [0, 0], start_coordinate: [0, 0], observationId: keyed.observationId }, undefined, f.binding)
    expect(f.actions.map(action => action.kind)).toEqual(['focus_window', 'key', 'drag'])
    await f.controller.finishRun(f.binding)
  })
  test('When 高风险取消 Then 没有任何 perform', async () => {
    const f = createComputerFixture()
    f.setContext({ role: 'AXButton', title: '删除' })
    f.auth.setUiHandlers({ riskConfirm: async () => false })
    const observed = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
    await expect(f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: observed.observationId }, undefined, f.binding)).rejects.toThrow('取消')
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
})
