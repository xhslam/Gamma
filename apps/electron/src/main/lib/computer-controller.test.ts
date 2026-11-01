import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'

const screenshot = { action: 'screenshot' }

describe('Given 与其他工具平级的按需 Computer Use', () => {
  test('When 用户直接调用 screenshot Then 绑定真实运行并返回截图', async () => {
    const f = createComputerFixture()
    const result = await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    expect(result.image?.width).toBe(1)
    expect(f.controller.getState().sessionId).toBe(f.binding.sessionId)
    expect(f.controller.isDesktopRun(f.binding)).toBe(true)
    for (const name of ['Bash', 'read', 'mcp__service__read', 'computer']) {
      expect(() => f.controller.assertTool(f.binding, name)).not.toThrow()
    }
    await f.controller.finishRun(f.binding)
  })

  test('When 本轮结束再发新任务 Then 不要求重新启用且不阻断普通运行', async () => {
    const f = createComputerFixture()
    await f.controller.executeAutonomousAction(screenshot, undefined, f.binding)
    const release = f.controller.reserveRun('other-file-session')
    release()
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
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, f.binding)).rejects.toThrow('暂停')
    await f.controller.finishRun(f.binding)

    const next = { ...f.binding, runId: 'next-user-message' }
    f.controller.beginRun(next, 'user', true)
    await f.controller.executeAutonomousAction(screenshot, undefined, next)
    await f.controller.finishRun(next)
  })

  test('When 后台来源或伪造绑定 Then 不启动 helper', async () => {
    for (const options of [{ source: 'automation' }, { source: 'delegation' }]) {
      const f = createComputerFixture(options)
      await expect(f.controller.executeAutonomousAction(screenshot, undefined, f.binding)).rejects.toThrow()
    }
    const f = createComputerFixture()
    await expect(f.controller.executeAutonomousAction(screenshot, undefined, { ...f.binding, runId: 'forged' })).rejects.toThrow('有效运行')
  })

  test('When 用户拒绝外发同意 Then 不读取桌面或启动应用', async () => {
    const f = createComputerFixture({ consent: false })
    f.auth.setUiHandlers({ observationConsent: async () => false })
    await expect(f.controller.executeAutonomousAction({ action: 'open_app', app: 'Notes' }, undefined, f.binding)).rejects.toThrow('外发同意')
    expect(f.calls.filter(call => call.method !== 'terminate')).toHaveLength(0)
  })

  test('When 原生回执错误或拒绝 Then 不宣称执行成功且不自动重放', async () => {
    const f = createComputerFixture({
      call: async () => ({
        version: '2.5',
        ok: false,
        command: 'press',
        error: {
          code: 'EXEC_FAILED',
          message: '模拟原生按键投递失败',
          disposition: { delivery: 'undelivered', retry: 'unsafe' },
        },
      }),
    })
    await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'cmd+n' }, undefined, f.binding)).rejects.toThrow('原生按键投递失败')
    await f.controller.finishRun(f.binding)
  })

  test('When 目标应用未授权且用户取消 Then 拒绝执行操作', async () => {
    const f = createComputerFixture({ trustedApps: false })
    f.auth.setUiHandlers({ appAuth: async () => 'denied' })
    await expect(
      f.controller.executeAutonomousAction({ action: 'open_app', app: 'UnapprovedApp' }, undefined, f.binding),
    ).rejects.toThrow('拒绝')
    await f.controller.finishRun(f.binding)
  })

  test('When 点击或等待参数无效 Then 明确拒绝执行', async () => {
    const f = createComputerFixture()
    for (const action of [
      { action: 'click', x: -1, y: 0 },
      { action: 'click', x: 1, y: 0 },
      { action: 'wait', duration: Number.NaN },
      { action: 'wait', duration: 15 },
    ]) {
      await expect(f.controller.executeAutonomousAction(action, undefined, f.binding)).rejects.toThrow()
    }
    await f.controller.finishRun(f.binding)
  })

  test('When 调用列窗、聚焦、组合键和拖拽 Then 使用新 agent-desktop 命令协议', async () => {
    const f = createComputerFixture()
    const listed = await f.controller.executeAutonomousAction({ action: 'list_windows' }, undefined, f.binding)
    expect(listed.windows?.[0]?.windowId).toBe(12)
    await f.controller.executeAutonomousAction({ action: 'focus_window', windowId: 12 }, undefined, f.binding)
    const keyed = await f.controller.executeAutonomousAction({ action: 'key', key: 'cmd+shift+n' }, undefined, f.binding)
    await f.controller.executeAutonomousAction({ action: 'drag', coordinate: [100, 100], start_coordinate: [0, 0], observationId: keyed.observationId }, undefined, f.binding)
    expect(f.actions.map(action => action.kind)).toEqual(['list-windows', 'focus_window', 'key', 'drag'])
    await f.controller.finishRun(f.binding)
  })

  test('When 高风险动作（如 close-app）用户取消确认 Then 阻断执行且不发送命令', async () => {
    const f = createComputerFixture()
    f.auth.setUiHandlers({ riskConfirm: async () => false })
    await expect(
      f.controller.execute(f.binding, { command: 'close-app', app: 'Notes' }),
    ).rejects.toThrow('用户已取消高风险动作')
    expect(f.actions.filter(a => a.kind === 'close-app')).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })

  test('When 未开启 headed 许可 When 执行 headed 操作 Then 明确阻断且不隐式降级', async () => {
    const f = createComputerFixture({ headed: false })
    await expect(
      f.controller.execute(f.binding, { command: 'mouse-click', xy: '100,200', headed: true }),
    ).rejects.toThrow('未开启物理键鼠输入许可')
    await f.controller.finishRun(f.binding)
  })
})
