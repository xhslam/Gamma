import { describe, expect, test } from 'bun:test'
import { createComputerFixture, tinyComputerImage } from '../../test-utils/computer-fixture'

function semanticFixture() {
  let generation = 0
  const fixture = createComputerFixture({ call: async (method, params) => method === 'observe' ? {
    observationId: `semantic-native-${++generation}`, epoch: params.epoch, image: tinyComputerImage,
    ax: `ref=window-${generation} 0 AXWindow title=Notes\nref=body-${generation} 1 AXTextArea value=正文 actions=[AXPress]`,
    targetApp: { name: 'Notes', bundleId: 'com.apple.Notes' },
  } : undefined })
  return { ...fixture, execute: (params: Parameters<typeof fixture.controller.executeAutonomousAction>[0], signal?: AbortSignal) => fixture.controller.executeAutonomousAction(params, signal, fixture.binding) }
}

describe('Given 接近 Sky 的应用定向与快照语义操作', () => {
  test('When 观察已在前台的应用 Then 不重复打开，返回 AX/索引/观察 ID', async () => {
    const f = semanticFixture()
    const observed = await f.execute({ action: 'get_app_state', app: 'Notes' })
    expect(observed.observationId).toBeString()
    expect(observed.ax).toContain('[2] ref=body-')
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 用最新元素索引清空文本 Then 原生收到 axSetValue 和同一快照引用', async () => {
    const f = semanticFixture()
    const state = await f.execute({ action: 'get_app_state', app: 'Notes' })
    const ref = state.ax!.match(/ref=(body-\d+)/)![1]!
    const result = await f.execute({ action: 'set_value', app: 'Notes', observationId: state.observationId, element_index: 2, text: '' })
    expect(f.actions[0]).toMatchObject({ kind: 'axSetValue', text: '', elementRef: ref, bundleId: 'com.apple.Notes' })
    expect(result.observationId).not.toBe(state.observationId)
    expect(result.observationStability).toBe('stable')
    expect(result.axDiff).toContain('旧元素引用已失效')
    await f.controller.finishRun(f.binding)
  })
  test('When 点击元素 Then 使用 AXPress，动作后不得沿用旧观察', async () => {
    const f = semanticFixture()
    const state = await f.execute({ action: 'get_app_state' })
    await f.execute({ action: 'click', observationId: state.observationId, element_index: 2 })
    expect(f.actions[0]?.kind).toBe('axPress')
    const count = f.calls.filter(call => call.method === 'prepare').length
    await expect(f.execute({ action: 'click', observationId: state.observationId, element_index: 2 })).rejects.toThrow('最新 observationId')
    expect(f.calls.filter(call => call.method === 'prepare')).toHaveLength(count)
    await f.controller.finishRun(f.binding)
  })
  test('When 缺少观察ID、引用伪造或索引与ref冲突 Then 不投递动作', async () => {
    for (const variant of ['missing', 'forged', 'conflict']) {
      const f = semanticFixture()
      const state = await f.execute({ action: 'get_app_state' })
      const params = variant === 'missing' ? { element_index: 2 } : variant === 'forged' ? { observationId: state.observationId, elementRef: 'forged' } : { observationId: state.observationId, elementRef: 'forged', element_index: 2 }
      await expect(f.execute({ action: 'set_value', ...params, text: 'x' })).rejects.toThrow(variant === 'missing' ? 'observationId' : variant === 'forged' ? '不属于最新观察' : '不一致')
      expect(f.actions).toHaveLength(0)
      await f.controller.finishRun(f.binding)
    }
  })
  test('When 引用超时 Then 不自动刷新观察后套用旧索引', async () => {
    const f = semanticFixture()
    const state = await f.execute({ action: 'get_app_state' })
    f.advance(31_000)
    const count = f.calls.filter(call => call.method === 'observe').length
    await expect(f.execute({ action: 'focus', observationId: state.observationId, element_index: 2 })).rejects.toThrow('最新 observationId')
    expect(f.calls.filter(call => call.method === 'observe')).toHaveLength(count)
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 显式坐标观察已过期 Then 不刷新后重绑旧动作', async () => {
    for (const params of [{ action: 'click', coordinate: [0, 0] as [number, number] }, { action: 'drag', coordinate: [0, 0] as [number, number], start_coordinate: [0, 0] as [number, number] }, { action: 'key', key: 'Tab' }]) {
      const f = semanticFixture()
      const observed = await f.execute({ action: 'get_app_state' })
      f.advance(31_000)
      const before = f.calls.length
      await expect(f.execute({ ...params, observationId: observed.observationId })).rejects.toThrow('已过期')
      expect(f.calls.slice(before).some(call => ['observe', 'prepare', 'perform'].includes(call.method))).toBe(false)
      await f.controller.finishRun(f.binding)
    }
  })
  test('When 用户取消风险确认 Then 只取消当前动作，旧引用失效但可以继续观察', async () => {
    const f = semanticFixture()
    const observed = await f.execute({ action: 'get_app_state' })
    f.setContext({ role: 'AXButton', title: '删除' })
    f.auth.setUiHandlers({ riskConfirm: async () => false })
    await expect(f.execute({ action: 'click', observationId: observed.observationId, element_index: 2 })).rejects.toThrow('未获确认')
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    expect(f.controller.getState().phase).toBe('active')
    expect(f.controller.getState().message).not.toContain('等待本地确认')
    await expect(f.execute({ action: 'click', observationId: observed.observationId, element_index: 2 })).rejects.toThrow('观察')
    const fresh = await f.execute({ action: 'screenshot' })
    expect(fresh.observationId).not.toBe(observed.observationId)
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 自动程序改变前台但缓存未变 Then 定向观察仍激活正确应用', async () => {
    let front = 'com.apple.Notes'
    const f = createComputerFixture({ call: async (method, params) => {
      if (method === 'observe') return { observationId: `front-${front}`, epoch: params.epoch, image: tinyComputerImage, ax: '', targetApp: { name: front, bundleId: front } }
      if (method === 'perform') {
        const action = params.action as Record<string, unknown>
        if (action.kind === 'open_app') front = String(action.bundleId)
      }
      return undefined
    } })
    await f.controller.executeAutonomousAction({ action: 'get_app_state', app: 'Notes' }, undefined, f.binding)
    front = 'com.apple.Safari'
    const state = await f.controller.executeAutonomousAction({ action: 'get_app_state', app: 'Notes' }, undefined, f.binding)
    expect(f.actions.at(-1)).toMatchObject({ kind: 'open_app', bundleId: 'com.apple.Notes' })
    expect(state.state?.targetApp?.bundleId).toBe('com.apple.Notes')
    await f.controller.finishRun(f.binding)
  })
  test('When 指定另一应用写操作 Then 不切换后沿用旧坐标或焦点', async () => {
    const f = semanticFixture()
    await f.execute({ action: 'get_app_state', app: 'Notes' })
    await expect(f.execute({ action: 'press_key', app: 'Safari', key: 'cmd+n' })).rejects.toThrow('不是当前观察目标')
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 明确观察另一应用 Then 通过有授权的 open_app 路径切换', async () => {
    const f = createComputerFixture()
    const result = await f.controller.executeAutonomousAction({ action: 'get_app_state', app: 'Safari' }, undefined, f.binding)
    expect(f.actions).toHaveLength(1)
    expect(f.actions[0]).toMatchObject({ kind: 'open_app', bundleId: 'com.apple.Safari' })
    expect(result.state?.targetApp?.bundleId).toBe('com.apple.Safari')
    expect(result.observationId).toBeString()
    await f.controller.finishRun(f.binding)
  })
  test('When 选文传递消歧与光标方向 Then 字段绑定同一不可变动作', async () => {
    const f = semanticFixture()
    const observed = await f.execute({ action: 'get_app_state' })
    await f.execute({ action: 'select_text', observationId: observed.observationId, element_index: 2, selectionText: '正文', prefix: '前', suffix: '后', selectionType: 'cursor_after' })
    expect(f.actions[0]).toMatchObject({ kind: 'axSelectText', selectionText: '正文', prefix: '前', suffix: '后', selectionType: 'cursor_after' })
    await f.controller.finishRun(f.binding)
  })
  test('When 多行Markdown插入 Then 通过AX插入，不转换为逐键换行输入', async () => {
    const f = semanticFixture()
    await f.execute({ action: 'paste', app: 'Notes', text: '**第一行**\n第二行', format: 'md' })
    expect(f.actions[0]).toMatchObject({ kind: 'paste', format: 'md', text: '**第一行**\n第二行' })
    await f.controller.finishRun(f.binding)
  })
  test('When 请求尚不支持的HTML富文本 Then 在读取桌面或修改应用前明确拒绝', async () => {
    const f = semanticFixture()
    await expect(f.execute({ action: 'paste', app: 'Notes', text: '<b>x</b>', format: 'html' })).rejects.toThrow('不支持 HTML 富文本')
    expect(f.calls.filter(call => call.method !== 'terminate')).toHaveLength(0)
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When native 实际命中应用不匹配 Then 即使宿主错误也不投递', async () => {
    const f = createComputerFixture({ call: async method => method === 'prepare' ? { preparationId: 'mismatch', appName: 'Safari', bundleId: 'com.apple.Safari', context: { role: 'AXTextArea' } } : undefined })
    await expect(f.controller.executeAutonomousAction({ action: 'type', app: 'Notes', text: 'x' }, undefined, f.binding)).rejects.toThrow('原生命中应用')
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 发现应用 Then 有界解析应用列表且不启动它们', async () => {
    const f = createComputerFixture({ call: async method => method === 'listApps' ? { apps: [{ appName: 'Notes', bundleId: 'com.apple.Notes', pid: 34, isRunning: true }] } : undefined })
    const result = await f.controller.executeAutonomousAction({ action: 'list_apps' }, undefined, f.binding)
    expect(result.apps).toEqual([{ appName: 'Notes', bundleId: 'com.apple.Notes', pid: 34, isRunning: true }])
    expect(result.message).toContain('不代表全部已安装应用')
    expect(f.actions).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })
  test('When 截图与应用重绘竞争 Then 只重采样只读观察且不重放写动作', async () => {
    let failNextObserve = false
    const f = createComputerFixture({ call: async method => {
      if (method === 'perform') failNextObserve = true
      if (method === 'observe' && failNextObserve) {
        failNextObserve = false
        throw Object.assign(new Error('截图期间布局变化'), { code: 'observation-layout-changed' })
      }
      return undefined
    } })
    const result = await f.controller.executeAutonomousAction({ action: 'type', text: 'x' }, undefined, f.binding)
    expect(result.observationId).toBeString()
    expect(f.actions).toHaveLength(1)
    expect(f.calls.filter(call => call.method === 'perform')).toHaveLength(1)
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    await f.controller.finishRun(f.binding)
  })
  test('When 连续变化超过采样次数 Then 不伪报稳定，也不重新投递', async () => {
    let generation = 0
    const f = createComputerFixture({ call: async (method, params) => method === 'observe' ? {
      observationId: `changing-${++generation}`, epoch: params.epoch, image: tinyComputerImage,
      ax: `ref=changing-${generation} 0 AXTextArea value=${generation}`, targetApp: { name: 'Notes', bundleId: 'com.apple.Notes' },
    } : undefined })
    const result = await f.controller.executeAutonomousAction({ action: 'type_text', text: 'x' }, undefined, f.binding)
    expect(result.observationStability).toBe('timeout')
    expect(result.observationId).toBeDefined()
    expect(result.ax).toContain(`value=${generation}`)
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    expect(f.actions).toHaveLength(1)
    await f.controller.finishRun(f.binding)
  })
  test('When 原生回执为 unknown Then 明确暂停且同轮不能恢复', async () => {
    const f = createComputerFixture({ call: async (method, params) => method === 'perform' ? { actionId: params.actionId, outcome: 'unknown', message: '可能部分执行' } : undefined })
    await expect(f.controller.executeAutonomousAction({ action: 'type', text: 'x' }, undefined, f.binding)).rejects.toThrow('本轮电脑操作已暂停')
    expect(f.controller.isRunStopped(f.binding.runId)).toBe(true)
    await expect(f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)).rejects.toThrow()
    await f.controller.finishRun(f.binding)
  })
})
