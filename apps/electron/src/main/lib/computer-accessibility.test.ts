import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'
import { ComputerNativeHostError } from './computer-native-host'

const axPermissions = { accessibility: true, screen: false, listen: false, post: false }
function accessibilityFixture(vision = true) {
  let generation = 0
  const fixture = createComputerFixture({ policy: 'relaxed', trustedApps: false, vision, call: async (method, params) => {
    if (method === 'status') return { supported: true, permissions: axPermissions }
    if (method === 'observe') return { observationId: `native-ax-${++generation}`, epoch: params.epoch, width: 1440, height: 900,
      ax: `ref=field-${generation} role=AXTextArea title=Draft`, targetApp: { name: 'Notes', bundleId: 'com.apple.Notes' } }
    return undefined
  } })
  fixture.auth.setUiHandlers({ appAuth: async () => { throw new Error('基础操作不应逐应用询问') }, riskConfirm: async () => { throw new Error('普通编辑不应逐动作询问') } })
  return fixture
}

describe('Given 只开启 Gamma 辅助功能的 Mac', () => {
  test('When 获取界面状态 Then 不请求录屏/输入监听/事件发布，返回真实 AX 而非伪造图片', async () => {
    const f = accessibilityFixture()
    try {
      const result = await f.controller.executeAutonomousAction({ action: 'get_app_state', includeAX: false }, undefined, f.binding)
      expect(result.image).toBeUndefined()
      expect(result.ax).toContain('ref=field-1')
      expect(result.state?.phase).toBe('active')
      expect(f.calls.filter(call => call.method === 'requestPermission')).toHaveLength(0)
      const preview = await f.controller.getPreview({ sessionId: f.binding.sessionId, runId: f.binding.runId, live: true })
      expect(preview?.mode).toBe('accessibility')
      expect(preview?.frame).toBeUndefined()
      expect(f.calls.filter(call => call.method === 'previewFrame')).toHaveLength(0)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 依次聚焦、编辑草稿、输入和快捷键 Then 全部投递且无需额外确认', async () => {
    const f = accessibilityFixture()
    try {
      let state = await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
      state = await f.controller.executeAutonomousAction({ action: 'focus', element_index: 1, observationId: state.observationId }, undefined, f.binding)
      state = await f.controller.executeAutonomousAction({ action: 'set_value', element_index: 1, observationId: state.observationId, text: 'Gamma AX 验证\n第二行' }, undefined, f.binding)
      state = await f.controller.executeAutonomousAction({ action: 'type', text: '继续编辑' }, undefined, f.binding)
      await f.controller.executeAutonomousAction({ action: 'key', key: 'ArrowLeft' }, undefined, f.binding)
      expect(f.actions.map(action => action.kind)).toEqual(['axFocus', 'axSetValue', 'type', 'key'])
      expect(state.image).toBeUndefined()
      expect(f.calls.filter(call => call.method === 'confirmation')).toHaveLength(0)
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 无坐标滚动 Then 由原生层定位已验证的可见焦点控件', async () => {
    const f = accessibilityFixture()
    try {
      const observed = await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
      await f.controller.executeAutonomousAction({ action: 'scroll', delta_y: -300, observationId: observed.observationId }, undefined, f.binding)
      expect(f.actions[0]?.kind).toBe('scroll')
      expect(f.actions[0]?.x).toBeUndefined()
      expect(f.actions[0]?.y).toBeUndefined()
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 无截图却传像素点击或滚动 Then 仅拒绝该动作，仍可重新观察', async () => {
    for (const action of ['click', 'scroll', 'drag']) {
      const f = accessibilityFixture()
      try {
        const observed = await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
        await expect(f.controller.executeAutonomousAction({ action, coordinate: [1, 1], observationId: observed.observationId }, undefined, f.binding)).rejects.toThrow('缺少 屏幕录制 权限')
      expect(f.actions).toHaveLength(0)
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
      } finally { await f.controller.finishRun(f.binding) }
    }
  })
  test('When 模型不支持图像 Then 仍可使用 AX，明确要求原生观察不附带图片', async () => {
    const f = accessibilityFixture(false)
    try {
      const result = await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
      expect(result.ax).toContain('AXTextArea')
      expect(result.image).toBeUndefined()
      expect(f.calls.find(call => call.method === 'observe')?.params.includeImage).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 非视觉模型的宿主意外返回图片 Then 主进程仍剥离图片并禁用像素动作', async () => {
    const f = createComputerFixture({ vision: false })
    try {
      const result = await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
      expect(result.image).toBeUndefined()
      expect(f.controller.getPrivateObservations(f.binding)[0]?.image).toBeUndefined()
      await expect(f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: result.observationId }, undefined, f.binding)).rejects.toThrow('辅助功能模式')
      expect(f.actions).toHaveLength(0)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 用户显式开启画面预览 Then 运行中可请求可选录屏而不撤销租约', async () => {
    const f = accessibilityFixture()
    try {
      await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
      const state = await f.controller.requestPermission('screen')
      expect(state.permissions?.screen).toBe(true)
      expect(f.controller.isDesktopRun(f.binding)).toBe(true)
      expect(f.calls.filter(call => call.method === 'requestPermission').map(call => call.params.permission)).toEqual(['screen'])
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 查询状态 Then 读取当前系统权限而非旧缓存，且不请求任何授权', async () => {
    const f = accessibilityFixture()
    try {
      expect(f.controller.getState().permissions).toBeUndefined()
      const state = await f.controller.refreshState(f.binding.sessionId)
      expect(state.permissions).toEqual(axPermissions)
      expect(f.calls.map(call => call.method)).toEqual(['status'])
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 已投递动作仍在返回而用户开启画面 Then 完成该动作和观察后再请求录屏', async () => {
    let release!: () => void, entered!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const performing = new Promise<void>(resolve => { entered = resolve })
    const f = createComputerFixture({ call: async method => {
      if (method === 'perform') { entered(); await barrier }
      return undefined
    } })
    try {
      const action = f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)
      await performing
      const screen = f.controller.requestPermission('screen')
      expect(f.calls.filter(call => call.method === 'requestPermission')).toHaveLength(0)
      release()
      const [result, state] = await Promise.all([action, screen])
      expect(result.observationStability).toBe('stable')
      expect(f.actions).toHaveLength(1)
      expect(state.phase).toBe('active')
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
      const lastObservation = f.calls.findLastIndex(call => call.method === 'observe')
      expect(f.calls.findIndex(call => call.method === 'requestPermission')).toBeGreaterThan(lastObservation)
    } finally { release?.(); await f.controller.finishRun(f.binding) }
  })
  test('When 观察外部应用且无录屏时 Then 通过 open_app 切换目标并在辅助功能模式下成功返回 AX 树', async () => {
    let currentFront = { name: 'Finder', bundleId: 'com.apple.finder' }
    let generation = 0
    const f = createComputerFixture({
      policy: 'relaxed',
      trustedApps: true,
      call: async (method, params) => {
        if (method === 'status') return { supported: true, permissions: axPermissions }
        if (method === 'observe') {
          generation++
          return {
            observationId: `obs-${generation}`,
            epoch: params.epoch,
            width: 1440,
            height: 900,
            ax: currentFront.bundleId === 'com.apple.TextEdit'
              ? 'ref=text-1 role=AXTextArea title=未命名'
              : 'ref=finder-1 role=AXOutline title=访达',
            targetApp: currentFront,
          }
        }
        if (method === 'resolveApp') {
          const isTextEdit = String(params.appName).toLowerCase().includes('textedit')
          return isTextEdit ? { appName: 'TextEdit', bundleId: 'com.apple.TextEdit' } : { appName: 'Notes', bundleId: 'com.apple.Notes' }
        }
        if (method === 'prepare') {
          return { preparationId: String(params.actionId), appName: 'TextEdit', bundleId: 'com.apple.TextEdit', context: { role: 'AXApplication' } }
        }
        if (method === 'perform') {
          const action = params.action as Record<string, unknown>
          if (action.kind === 'open_app') {
            currentFront = { name: 'TextEdit', bundleId: 'com.apple.TextEdit' }
          }
          return { actionId: params.actionId, outcome: 'dispatched-unverified', message: '已投递' }
        }
        return undefined
      },
    })
    try {
      const result = await f.controller.executeAutonomousAction({ action: 'get_app_state', app: 'TextEdit' }, undefined, f.binding)
      expect(result.state?.targetApp?.bundleId).toBe('com.apple.TextEdit')
      expect(result.ax).toContain('role=AXTextArea')
      expect(result.image).toBeUndefined()
      expect(f.calls.some(c => c.method === 'perform' && (c.params.action as Record<string, unknown>)?.kind === 'open_app')).toBe(true)
    } finally { await f.controller.finishRun(f.binding) }
  })
})

describe('Given 原生层尚未投递任何动作', () => {
  test('When 控件不支持操作 Then 允许重新观察规划，不停止整个任务', async () => {
    for (const code of ['unsupported-action', 'unsafe-element', 'unknown-target']) {
      const f = createComputerFixture({ call: async method => { if (method === 'prepare') throw new ComputerNativeHostError(code, '准备未完成') } })
      try {
        await expect(f.controller.executeAutonomousAction({ action: 'key', key: 'Tab' }, undefined, f.binding)).rejects.toHaveProperty('reobserveRequired', true)
        expect(f.actions).toHaveLength(0)
        expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
        await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
      } finally { await f.controller.finishRun(f.binding) }
    }
  })
})
