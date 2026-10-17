import { describe, expect, test } from 'bun:test'
import type { ComputerBinding } from '@gamma/shared'
import { ComputerController, validateComputerAction, type ComputerHost } from './computer-controller'

const binding: ComputerBinding = { sessionId: 's1', runId: 'r1', channelId: 'c1', modelId: 'vision' }
function fixture(options: { wrongReceipt?: boolean } = {}) {
  const calls: string[] = []
  let delayed: ((value: unknown) => void) | undefined
  let deferSelect = false
  const host: ComputerHost = {
    async call(method, params) {
      calls.push(method)
      if (method === 'select') {
        if (deferSelect) return new Promise(resolve => { delayed = resolve })
        return { target: { windowId: 12, pid: 34, processIdentity: 'start-123', bundleId: 'fixture', title: '合成目标', bounds: { x: -100, y: 0, width: 800, height: 600 } } }
      }
      if (method === 'observe') return {
        observationId: 'native-observation-1', epoch: 1,
        image: { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0m0AAAAASUVORK5CYII=', mimeType: 'image/png', width: 1, height: 1 },
        ax: 'AX_PRIVATE_CANARY',
      }
      if (method === 'perform') return { actionId: options.wrongReceipt ? 'wrong-id' : params?.actionId, outcome: 'dispatched-unverified', message: '不把投递成功当作业务成功' }
      return { supported: true, permissions: { accessibility: true, screen: true, listen: true, post: true } }
    },
    async terminate() { calls.push('terminate') },
  }
  const controller = new ComputerController(host, { supported: true, now: () => 1000 })
  return { controller, calls, delaySelect: () => { deferSelect = true }, resolveSelect: (value: unknown) => delayed?.(value) }
}
async function armAndRun(controller: ComputerController) {
  controller.beginRun({ ...binding, runId: 'normal' }, 'user', true)
  await controller.finishRun({ ...binding, runId: 'normal' })
  const state = controller.getState('s1')
  await controller.arm({ sessionId: 's1', shareObservations: true, consentId: state.consentId! })
  controller.beginRun(binding, 'user', true)
}

describe('Given 原生桌面安全控制', () => {
  test('When 文本处于UTF16边界 Then 与native统一256单元且AX可以清空', () => {
    const descriptor = { observationId: 'x', epoch: 1, width: 1, height: 1, createdAt: 1 }
    expect(() => validateComputerAction({ kind: 'type', observationId: 'x', text: '😀'.repeat(128) }, descriptor)).not.toThrow()
    expect(() => validateComputerAction({ kind: 'type', observationId: 'x', text: '😀'.repeat(129) }, descriptor)).toThrow()
    expect(() => validateComputerAction({ kind: 'axSetValue', observationId: 'x', elementRef: 'ref', text: '' }, descriptor)).not.toThrow()
    expect(() => validateComputerAction({ kind: 'type', observationId: 'x', text: '' }, descriptor)).toThrow()
  })
  test('When 桌面撤权 Then 同步取消对应query且旧绑定不能订阅新租约', async () => {
    const { controller } = fixture()
    await armAndRun(controller)
    let cancelled = false
    controller.onRevoked(binding, () => { cancelled = true })
    const stopping = controller.stop()
    expect(cancelled).toBe(true)
    expect(() => controller.onRevoked(binding, () => {})).toThrow()
    await stopping
  })

  test('When 无可信本地授权 Then 模型不能自行开始观察', async () => {
    const { controller, calls } = fixture()
    controller.beginRun(binding, 'user', true)
    await expect(controller.observe(binding)).rejects.toThrow()
    expect(calls).toEqual([])
  })
  test('When 配置下一轮桌面模式 Then 通用执行与其他会话均拒绝', async () => {
    const { controller } = fixture()
    await armAndRun(controller)
    expect(() => controller.assertTool(binding, 'Bash')).toThrow()
    expect(() => controller.assertTool(binding, 'TerminalExecute')).toThrow()
    expect(() => controller.assertTool(binding, 'mcp__server__exec')).toThrow()
    expect(() => controller.assertTool(binding, 'ComputerObserve')).not.toThrow()
    expect(() => controller.beginRun({ ...binding, sessionId: 's2' }, 'user', true)).toThrow()
  })
  test('When 后台来源或未知视觉能力 Then 不能开启桌面外发', async () => {
    for (const source of ['automation', 'delegation', 'external'] as const) {
      const { controller } = fixture()
      controller.beginRun(binding, source, true)
      await controller.finishRun(binding)
      await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId: controller.getState('s1').consentId! })).rejects.toThrow()
    }
    const { controller } = fixture()
    controller.beginRun(binding, 'user', false)
    await controller.finishRun(binding)
    await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId: controller.getState('s1').consentId! })).rejects.toThrow()
  })
  test('When 旧渠道确认或仍有其他运行 Then 不接受授权', async () => {
    const { controller } = fixture()
    controller.beginRun(binding, 'user', true)
    await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId: controller.getState('s1').consentId! })).rejects.toThrow()
    await controller.finishRun(binding)
    const old = controller.getState('s1').consentId!
    controller.beginRun({ ...binding, channelId: 'c2' }, 'user', true)
    await controller.finishRun({ ...binding, channelId: 'c2' })
    await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId: old })).rejects.toThrow()
  })
  test('When 观察成功 Then 持久结果只含 opaque 引用，原图AX仅留内存', async () => {
    const { controller } = fixture()
    await armAndRun(controller)
    const result = await controller.observe(binding)
    expect(JSON.stringify(result)).not.toContain('AX_PRIVATE_CANARY')
    expect(JSON.stringify(controller.getState())).not.toContain('AX_PRIVATE_CANARY')
    const ephemeral = controller.getPrivateObservations(binding)
    expect(ephemeral[0]?.ax).toBe('AX_PRIVATE_CANARY')
    expect(result.observationId).not.toBe('native-observation-1')
    await controller.stop('测试停止')
    expect(controller.getPrivateObservations(binding)).toEqual([])
    await expect(controller.act(binding, { kind: 'click', observationId: result.observationId, x: 0, y: 0 })).rejects.toThrow()
  })
  test('When 单次动作已提交 Then 观察不可重放，未知副作用不重试', async () => {
    const { controller, calls } = fixture()
    await armAndRun(controller)
    const observed = await controller.observe(binding)
    const action = { kind: 'click' as const, observationId: observed.observationId, x: 0, y: 0 }
    const receipt = await controller.act(binding, action)
    expect(receipt.outcome).toBe('dispatched-unverified')
    await expect(controller.act(binding, action)).rejects.toThrow()
    expect(calls.filter(item => item === 'perform')).toHaveLength(1)
  })
  test('When 目标选择中停止 Then 迟到结果不能恢复授权', async () => {
    const { controller, delaySelect, resolveSelect } = fixture()
    await armAndRun(controller)
    delaySelect()
    const observing = controller.observe(binding)
    await controller.stop('用户撤销')
    resolveSelect({ target: { windowId: 12, pid: 34, processIdentity: 'x', bundleId: 'fixture', title: 'x', bounds: { x: 0, y: 0, width: 10, height: 10 } } })
    await expect(observing).rejects.toThrow()
    expect(controller.getState().phase).toBe('disabled')
    expect(controller.getPrivateObservations(binding)).toEqual([])
  })
  test('When 本地单次同意已用过 Then 停止后旧consentId不能重放', async () => {
    const { controller } = fixture()
    controller.beginRun({ ...binding, runId: 'normal' }, 'user', true)
    await controller.finishRun({ ...binding, runId: 'normal' })
    const consentId = controller.getState('s1').consentId!
    await controller.arm({ sessionId: 's1', shareObservations: true, consentId })
    await controller.stop()
    expect(controller.getState().phase).toBe('disabled')
    await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId })).rejects.toThrow()
  })
  test('When 凭据预检仍在途 Then 不能抢先授予桌面模式', async () => {
    const { controller } = fixture()
    controller.beginRun(binding, 'user', true)
    await controller.finishRun(binding)
    const release = controller.reserveRun('other')
    await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId: controller.getState('s1').consentId! })).rejects.toThrow()
    release()
    await expect(controller.arm({ sessionId: 's1', shareObservations: true, consentId: controller.getState('s1').consentId! })).resolves.toMatchObject({ phase: 'armed' })
    await controller.stop()
  })
  test('When native动作回执不属于本次动作 Then 按副作用未知停止而不认可成功', async () => {
    const { controller } = fixture({ wrongReceipt: true })
    await armAndRun(controller)
    const descriptor = await controller.observe(binding)
    const result = await controller.act(binding, { kind: 'click', observationId: descriptor.observationId, x: 0, y: 0 })
    expect(result.outcome).toBe('outcome-unknown')
    expect(controller.isExclusive()).toBe(false)
  })
  test('When 切换到无渠道确认的会话 Then 不展示前一会话的可授权上下文', async () => {
    const { controller } = fixture()
    controller.beginRun(binding, 'user', true)
    await controller.finishRun(binding)
    expect(controller.getState('s2').consentId).toBeUndefined()
    expect(controller.getState('s2').channelId).toBeUndefined()
  })
  test('When 坐标/文本/观察非法 Then native perform 不被调用', async () => {
    const { controller, calls } = fixture()
    await armAndRun(controller)
    const observation = await controller.observe(binding)
    await expect(controller.act(binding, { kind: 'click', observationId: observation.observationId, x: -1, y: 0 })).rejects.toThrow()
    await expect(controller.act(binding, { kind: 'type', observationId: observation.observationId, text: 'a'.repeat(257) })).rejects.toThrow()
    expect(calls).not.toContain('perform')
  })

  test('When 自主截图 Then 自动建立会话并返回图像数据与尺寸', async () => {
    const { controller, calls } = fixture()
    const result = await controller.screenshot()
    expect(calls).toContain('select')
    expect(calls).toContain('observe')
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
    expect(result.mimeType).toBe('image/png')
  })

  test('When 执行自主动作（如打开应用/按键/输入） Then 自动执行并返回最新屏幕快照', async () => {
    const { controller, calls } = fixture()
    // 第一次动作：open_app
    const openRes = await controller.executeAutonomousAction({ action: 'open_app', app: 'Notes' })
    expect(calls).toContain('select')
    expect(calls).toContain('perform')
    expect(calls).toContain('observe')
    expect(openRes.message).toContain('open_app')
    expect(openRes.image).toBeDefined()

    // 第二次动作：key
    const keyRes = await controller.executeAutonomousAction({ action: 'key', text: 'cmd+n' })
    expect(keyRes.message).toContain('key')
    expect(keyRes.image).toBeDefined()

    // 第三次动作：type
    const typeRes = await controller.executeAutonomousAction({ action: 'type', text: '测试' })
    expect(typeRes.message).toContain('type')
    expect(typeRes.image).toBeDefined()
  })
})


describe('Given 桌面控制暂停后的本地恢复', () => {
  test('When 暂停后 Agent 自动重试 Then 保持暂停；本地重新启用后才允许新初始化', async () => {
    const { controller, calls } = fixture()
    await controller.ensureDesktopSession()
    await controller.stop('用户暂停', 'paused')
    await expect(controller.ensureDesktopSession()).rejects.toThrow('重新启用')
    expect(calls.filter(call => call === 'select')).toHaveLength(1)
    const restored = await controller.resume()
    expect(restored.phase).toBe('disabled')
    expect(restored.resumeRequired).toBe(false)
    expect(calls.filter(call => call === 'select')).toHaveLength(1)
    await controller.ensureDesktopSession()
    expect(calls.filter(call => call === 'select')).toHaveLength(2)
    await controller.stop()
  })

  test('When 旧 helper 未证明退出 Then 重新启用失败且不创建新租约', async () => {
    let selects = 0
    const controller = new ComputerController({
      async call() { selects++; return {} },
      async terminate() { throw new Error('退出失败') },
    }, { supported: true })
    await controller.stop()
    await expect(controller.resume()).rejects.toThrow('停止')
    await expect(controller.ensureDesktopSession()).rejects.toThrow()
    expect(selects).toBe(0)
  })

  test('When 初始化仍在途 Then 第二次初始化不能复用未就绪租约或开启新代际', async () => {
    const { controller, delaySelect, resolveSelect, calls } = fixture()
    delaySelect()
    const starting = controller.ensureDesktopSession()
    await expect(controller.ensureDesktopSession()).rejects.toThrow('在途')
    resolveSelect({ target: { windowId: 12, pid: 34, processIdentity: 'x', bundleId: 'fixture', title: 'x', bounds: { x: 0, y: 0, width: 10, height: 10 } } })
    await starting
    expect(calls).toEqual(['select'])
    await controller.stop()
  })
})

describe('Given 本地恢复与停止的并发屏障', () => {
  test('When 恢复清理期间用户再次停止 Then 迟到的恢复不得解除暂停', async () => {
    let finishStop!: () => void
    let selects = 0
    const controller = new ComputerController({
      async call() { selects++; return {} },
      terminate: () => new Promise<void>(resolve => { finishStop = resolve }),
    }, { supported: true })
    const resuming = controller.resume()
    const stopping = controller.stop('用户再次停止')
    finishStop()
    await stopping
    await expect(resuming).rejects.toThrow('取消')
    expect(controller.getState().resumeRequired).toBe(true)
    await expect(controller.ensureDesktopSession()).rejects.toThrow('重新启用')
    expect(selects).toBe(0)
  })

  test('When 停止尚未完成 Then 不启动新 helper 或增加 select 调用', async () => {
    let finishStop!: () => void
    let selects = 0
    const controller = new ComputerController({
      async call() { selects++; return {} },
      terminate: () => new Promise<void>(resolve => { finishStop = resolve }),
    }, { supported: true })
    const stopping = controller.stop()
    await expect(controller.ensureDesktopSession()).rejects.toThrow('停止')
    finishStop()
    await stopping
    expect(selects).toBe(0)
  })
})
