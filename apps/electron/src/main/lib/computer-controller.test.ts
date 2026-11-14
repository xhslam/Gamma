import { describe, expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('Given 生产 computer 执行入口', () => {
  test('When 原生返回观察 Then 如实返回 envelope，不生成虚构截图和窗口', async () => {
    const f = createComputerFixture({ call: async method => method === 'screenshot' ? { marker: 'native-observation' } : undefined })
    const result = await f.controller.execute(f.binding, { command: 'screenshot' })
    expect(result.data).toEqual({ marker: 'native-observation' })
    expect(result).not.toHaveProperty('image')
    expect(result).not.toHaveProperty('windows')
    expect(f.controller.isDesktopRun(f.binding)).toBe(true)
    await f.controller.finishRun(f.binding)
  })

  test('When 用户停止 Then 同轮不重放，下一条消息可以使用新 run', async () => {
    const f = createComputerFixture()
    await f.controller.execute(f.binding, { command: 'screenshot' })
    await f.controller.stop('用户接管', 'paused')
    const count = f.calls.length
    await expect(f.controller.execute(f.binding, { command: 'screenshot' })).rejects.toThrow('暂停')
    expect(f.calls).toHaveLength(count)
    await f.controller.finishRun(f.binding)
    const next = { ...f.binding, runId: 'next-message' }
    f.controller.beginRun(next, 'user', true)
    await expect(f.controller.execute(next, { command: 'screenshot' })).resolves.toMatchObject({ ok: true })
    await f.controller.finishRun(next)
  })

  test('When 后台来源或伪造绑定 Then 不调用原生执行器', async () => {
    for (const source of ['automation', 'delegation']) {
      const f = createComputerFixture({ source })
      await expect(f.controller.execute(f.binding, { command: 'screenshot' })).rejects.toThrow()
      expect(f.calls).toHaveLength(0)
      await f.controller.finishRun(f.binding)
    }
    const f = createComputerFixture()
    await expect(f.controller.execute({ ...f.binding, modelId: 'forged' }, { command: 'screenshot' })).rejects.toThrow('有效')
    expect(f.calls).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })

  test('When 没有观察同意或 headed 许可 Then 不执行', async () => {
    const f = createComputerFixture({ consent: false, headed: false })
    await expect(f.controller.execute(f.binding, { command: 'snapshot', app: 'Notes' })).rejects.toThrow('外发同意')
    f.auth.updatePreferences({ shareObservations: true })
    await expect(f.controller.execute(f.binding, { command: 'mouse-click', xy: '1,2', headed: true })).rejects.toThrow('物理键鼠')
    expect(f.calls).toHaveLength(0)
    await f.controller.finishRun(f.binding)
  })

  test('When 原生返回业务失败 Then 保留失败和 disposition，不自动重放', async () => {
    const f = createComputerFixture({ policy: 'relaxed', call: async () => ({ version: '2.5', command: 'press', ok: false,
      error: { code: 'EXEC_FAILED', message: '原生投递失败', disposition: { delivery: 'unknown', retry: 'unsafe' } } }) })
    const result = await f.controller.execute(f.binding, { command: 'press', combo: 'Tab' })
    expect(result).toMatchObject({ ok: false, error: { disposition: { retry: 'unsafe' } } })
    expect(f.calls).toHaveLength(1)
    await f.controller.finishRun(f.binding)
  })
})

describe('Given 正在等待本地确认', () => {
  test('When 尚未创建原生 run 就停止，随后风险批准到达 Then 不投递', async () => {
    const answer = deferred<boolean>()
    const entered = deferred<void>()
    const f = createComputerFixture()
    f.auth.setUiHandlers({ riskConfirm: async () => { entered.resolve(); return answer.promise } })
    const pending = f.controller.execute(f.binding, { command: 'clipboard-clear' })
    const rejection = pending.then(() => undefined, (error: unknown) => error)
    await entered.promise
    await f.controller.stop('用户停止')
    answer.resolve(true)
    expect(await rejection).toBeInstanceOf(Error)
    expect(f.calls.filter(call => call.method !== 'terminate')).toHaveLength(0)
  })

  test('When 应用授权等待期间停止 Then 迟到 always 不持久化也不投递', async () => {
    const answer = deferred<'always'>()
    const entered = deferred<void>()
    const f = createComputerFixture({ trustedApps: false, policy: 'standard' })
    f.auth.setUiHandlers({ appAuth: async () => { entered.resolve(); return answer.promise } })
    const pending = f.controller.execute(f.binding, { command: 'launch', app: 'Notes' })
    const rejection = pending.then(() => undefined, (error: unknown) => error)
    await entered.promise
    await f.controller.stop('用户停止')
    answer.resolve('always')
    expect(await rejection).toBeInstanceOf(Error)
    expect(f.auth.getPreferences().allowedApps).toEqual({})
    expect(f.actions).toHaveLength(0)
  })

  test('When 风险确认期间取消 signal 或撤销 headed Then 最终门禁阻断动作', async () => {
    for (const change of ['abort', 'headed'] as const) {
      const answer = deferred<boolean>()
      const entered = deferred<void>()
      const f = createComputerFixture()
      const abort = new AbortController()
      f.auth.setUiHandlers({ riskConfirm: async () => { entered.resolve(); return answer.promise } })
      const pending = f.controller.execute(f.binding, { command: 'clipboard-clear', headed: true }, abort.signal)
      const rejection = pending.then(() => undefined, (error: unknown) => error)
      await entered.promise
      if (change === 'abort') abort.abort()
      else f.auth.updatePreferences({ headedAllowed: false })
      answer.resolve(true)
      expect(await rejection).toBeInstanceOf(Error)
      expect(f.actions).toHaveLength(0)
      await f.controller.finishRun(f.binding)
    }
  })

  test('When 运行结束 Then 本次应用授权清除', async () => {
    const f = createComputerFixture({ trustedApps: false, policy: 'standard' })
    f.auth.recordAppDecision('Notes', 'once', 'com.apple.Notes', f.binding.runId)
    expect(f.auth.checkAppAuthorization('Notes', 'com.apple.Notes', f.binding.runId)).toBe('allowed')
    await f.controller.finishRun(f.binding)
    expect(f.auth.checkAppAuthorization('Notes', 'com.apple.Notes', f.binding.runId)).toBe('pending')
  })
})

describe('Given Windows 平台的桌面权限与执行', () => {
  test('When agent-desktop status 上报 not_required Then 权限映射为全部已就绪', async () => {
    const f = createComputerFixture({
      call: async (method) => {
        if (method === 'status') {
          return {
            version: '2.5',
            command: 'status',
            ok: true,
            data: {
              permissions: {
                accessibility: { state: 'not_required' },
                screen_recording: { state: 'not_required' },
              },
            },
          }
        }
        return undefined
      },
    })
    const state = await f.controller.refreshState('computer-test')
    expect(state.permissions?.accessibility).toBe(true)
    expect(state.permissions?.screen).toBe(true)
    await f.controller.finishRun(f.binding)
  })

  test('When Windows 平台调用 requestPermission Then 刷新状态且不向原生投递 --guide', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const f = createComputerFixture({
        call: async (method) => {
          if (method === 'status') {
            return {
              version: '2.5',
              command: 'status',
              ok: true,
              data: {
                permissions: {
                  accessibility: { state: 'not_required' },
                  screen_recording: { state: 'not_required' },
                },
              },
            }
          }
          return undefined
        },
      })
      const state = await f.controller.requestPermission('screen')
      expect(state.permissions?.screen).toBe(true)
      const guideCalls = f.calls.filter((c) => (c.params.args as string[])?.includes('--guide'))
      expect(guideCalls).toHaveLength(0)
      await f.controller.finishRun(f.binding)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })
})

test('Given 会话停止时原生退出缓慢 When 迟到应用批准到达 Then 在等待退出之前已失效', async () => {
  const answer = deferred<'always'>()
  const entered = deferred<void>()
  const exit = deferred<void>()
  const f = createComputerFixture({ trustedApps: false, policy: 'standard', call: async method => {
    if (method === 'terminate') await exit.promise
    return undefined
  } })
  f.auth.setUiHandlers({ appAuth: async () => { entered.resolve(); return answer.promise } })
  const pending = f.controller.execute(f.binding, { command: 'launch', app: 'Notes' }).catch((error: unknown) => error)
  await entered.promise
  const stopping = f.controller.stopForSession(f.binding.sessionId, '会话停止')
  answer.resolve('always')
  await pending
  expect(f.auth.getPreferences().allowedApps).toEqual({})
  exit.resolve()
  await stopping
  expect(f.actions).toHaveLength(0)
})

test('Given 原生观察进行中 When 授权发生变化 Then 不返回迟到观察，也不声称动作未投递', async () => {
  const f = createComputerFixture({ call: async method => {
    if (method !== 'snapshot') return undefined
    f.auth.updatePreferences({ headedAllowed: false })
    return { privateText: 'PRIVATE_LATE_OBSERVATION' }
  } })
  let error: unknown
  try { await f.controller.execute(f.binding, { command: 'snapshot', app: 'Notes' }) } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect(error).toHaveProperty('details.stopReason', '执行期间授权或运行状态已变化；动作可能已投递，观察结果已丢弃，不得重放。')
  expect((error as Error).message).not.toContain('PRIVATE_LATE_OBSERVATION')
  await f.controller.finishRun(f.binding)
})
