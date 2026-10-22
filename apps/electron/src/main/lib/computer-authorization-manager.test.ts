import { describe, expect, test, beforeEach } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ComputerAuthorizationManager } from './computer-authorization-manager'

describe('ComputerAuthorizationManager 应用授权与风险确认', () => {
  let manager: ComputerAuthorizationManager
  let tempConfigFile: string

  beforeEach(() => {
    tempConfigFile = join(tmpdir(), `gamma-test-auth-${randomUUID()}.json`)
    manager = new ComputerAuthorizationManager(tempConfigFile)
  })

  test('Given 首次安装 When 读取偏好 Then 不默认信任任何应用，外发也未同意', () => {
    const prefs = manager.getPreferences()
    expect(prefs.riskPolicy).toBe('standard')
    expect(prefs.allowedApps).toEqual({})
    expect(prefs.shareObservations).toBe(false)
    expect(manager.checkAppAuthorization('Notes')).toBe('pending')
    expect(manager.checkAppAuthorization('备忘录')).toBe('pending')
  })

  test('未知应用首次检查返回 pending', () => {
    expect(manager.checkAppAuthorization('Safari')).toBe('pending')
    expect(manager.checkAppAuthorization('Calculator')).toBe('pending')
  })

  test('用户授予“本次允许 (once)”时，当前实例允许且不持久化', () => {
    manager.recordAppDecision('Safari', 'once')
    expect(manager.checkAppAuthorization('Safari')).toBe('allowed')

    // 新建 manager 实例模拟重启后，once 决策丢失回到 pending
    const newManager = new ComputerAuthorizationManager(tempConfigFile)
    expect(newManager.checkAppAuthorization('Safari')).toBe('pending')
  })

  test('用户授予“总是允许 (always)”时，写入持久化配置', () => {
    manager.recordAppDecision('Safari', 'always', 'com.apple.Safari')
    expect(manager.checkAppAuthorization('Safari', 'com.apple.Safari')).toBe('allowed')
    expect(manager.checkAppAuthorization('com.apple.Safari')).toBe('allowed')

    // 新建 manager 实例模拟重启后，持久化决策依然生效
    const newManager = new ComputerAuthorizationManager(tempConfigFile)
    expect(newManager.checkAppAuthorization('Safari', 'com.apple.Safari')).toBe('allowed')
    expect(newManager.checkAppAuthorization('com.apple.Safari')).toBe('allowed')
  })

  test('用户拒绝应用时，后续检查返回 denied 并不允许执行', async () => {
    manager.recordAppDecision('MaliciousApp', 'denied')
    expect(manager.checkAppAuthorization('MaliciousApp')).toBe('denied')
    await expect(manager.ensureAppAuthorized('MaliciousApp')).rejects.toThrow('用户已明确拒绝')
  })

  test('UI 授权处理器正确响应并记录用户选择', async () => {
    let requestedApp = ''
    manager.setUiHandlers({
      appAuth: async (req) => {
        requestedApp = req.appName
        return 'always'
      },
    })

    const allowed = await manager.ensureAppAuthorized('Visual Studio Code')
    expect(allowed).toBe(true)
    expect(requestedApp).toBe('Visual Studio Code')
    expect(manager.checkAppAuthorization('Visual Studio Code')).toBe('allowed')
  })

  test('策略更新正确持久化', () => {
    manager.updatePreferences({ riskPolicy: 'relaxed', systemPermissionsDismissed: true })
    const updated = manager.getPreferences()
    expect(updated.riskPolicy).toBe('relaxed')
    expect(updated.systemPermissionsDismissed).toBe(true)

    const reloaded = new ComputerAuthorizationManager(tempConfigFile)
    expect(reloaded.getPreferences().riskPolicy).toBe('relaxed')
    expect(reloaded.getPreferences().systemPermissionsDismissed).toBe(true)
  })

  test('高风险确认处理器被正确调用', async () => {
    let confirmedTitle = ''
    manager.setUiHandlers({
      riskConfirm: async (req) => {
        confirmedTitle = req.title
        return true
      },
    })

    const passed = await manager.confirmRiskAction({
      requestId: 'test-r1',
      title: '支付确认',
      reason: '检测到支付操作',
      actionKind: 'click',
      authMethod: 'touch-id',
    })
    expect(passed).toBe(true)
    expect(confirmedTitle).toBe('支付确认')
  })
})

describe('Given 持久截图外发同意与失败关闭', () => {
  const create = () => new ComputerAuthorizationManager(join(tmpdir(), `gamma-consent-${randomUUID()}.json`))
  test('When 首次同意 Then 仅询问一次且配置可重载；dismiss不等于同意', async () => {
    const path = join(tmpdir(), `gamma-consent-${randomUUID()}.json`)
    const manager = new ComputerAuthorizationManager(path)
    manager.updatePreferences({ systemPermissionsDismissed: true })
    expect(manager.getPreferences().shareObservations).toBe(false)
    let count = 0
    manager.setUiHandlers({ observationConsent: async () => { count++; return true } })
    await manager.ensureObservationConsent(); await manager.ensureObservationConsent()
    expect(count).toBe(1)
    expect(new ComputerAuthorizationManager(path).getPreferences().shareObservations).toBe(true)
  })
  test('When 拒绝或 UI 抛错 Then 不记录同意', async () => {
    for (const handler of [async () => false, async () => { throw new Error('UI故障') }]) {
      const manager = create(); manager.setUiHandlers({ observationConsent: handler })
      await expect(manager.ensureObservationConsent()).rejects.toThrow('尚未同意')
      expect(manager.getPreferences().shareObservations).toBe(false)
    }
  })
  test('When 本次允许 Then 限定真实run，finish后清除且不能授权其他run', () => {
    const manager = create()
    manager.recordAppDecision('Notes', 'once', 'com.apple.Notes', 'run1')
    expect(manager.checkAppAuthorization('Notes', 'com.apple.Notes', 'run1')).toBe('allowed')
    expect(manager.checkAppAuthorization('Notes', 'com.apple.Notes', 'run2')).toBe('pending')
    manager.clearRun('run1')
    expect(manager.checkAppAuthorization('Notes', 'com.apple.Notes', 'run1')).toBe('pending')
  })
  test('When 应用名称说允许但bundle明确拒绝 Then 拒绝优先', () => {
    const manager = create()
    manager.recordAppDecision('Notes', 'always')
    manager.recordAppDecision('Notes', 'denied', 'com.apple.Notes')
    expect(manager.checkAppAuthorization('Notes', 'com.apple.Notes')).toBe('denied')
  })
  test('When 应用确认抛错、高风险确认抛错 Then 绝不自动允许', async () => {
    const manager = create()
    manager.setUiHandlers({ appAuth: async () => { throw new Error('UI unavailable') }, riskConfirm: async () => { throw new Error('UI unavailable') } })
    await expect(manager.ensureAppAuthorized('Unknown', 'example.unknown')).rejects.toThrow('未完成')
    expect(manager.checkAppAuthorization('Unknown', 'example.unknown')).toBe('pending')
    expect(await manager.confirmRiskAction({ requestId: 'risk', title: '提交', reason: '提交', actionKind: 'click', authMethod: 'dialog' })).toBe(false)
  })
  test('When 等待中的应用授权被停止 Then 立即拒绝且迟到UI答复失效', async () => {
    const manager = create()
    let request = ''
    manager.onAppAuthRequested(req => { request = req.requestId })
    const waiting = manager.ensureAppAuthorized('Unknown', 'example.unknown')
    manager.cancelPending()
    await expect(waiting).rejects.toThrow('停止')
    expect(manager.resolveAppAuth(request, 'always')).toBe(false)
    expect(manager.checkAppAuthorization('Unknown', 'example.unknown')).toBe('pending')
  })
  test('When IPC混入无效偏好和非布尔批准 Then 拒绝而不是存盘', () => {
    const manager = create()
    expect(() => manager.updatePreferences({ shareObservations: 'yes' } as unknown as Parameters<typeof manager.updatePreferences>[0])).toThrow()
    expect(() => manager.resolveRiskConfirm('id', 'false' as unknown as boolean)).toThrow()
  })
})

describe('Given 可恢复的本地应用授权', () => {
  const create = () => new ComputerAuthorizationManager(join(tmpdir(), `gamma-app-consent-${randomUUID()}.json`))
  test('When 授权UI失败后重试 Then 不保存拒绝且能够再次询问', async () => {
    const manager = create()
    manager.setUiHandlers({ appAuth: async () => { throw new Error('不可用') } })
    await expect(manager.ensureAppAuthorized('Example', 'example.app')).rejects.toThrow('未完成')
    expect(manager.getPreferences().allowedApps).toEqual({})
    manager.setUiHandlers({ appAuth: async () => 'always' })
    expect(await manager.ensureAppAuthorized('Example', 'example.app')).toBe(true)
  })
  test('When UI超时 Then 只拒绝本次且迟到答复不能保存', async () => {
    const manager = create()
    let requestId = ''
    manager.onAppAuthRequested(request => { requestId = request.requestId })
    const original = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void) => original(callback, 1)) as typeof setTimeout
    try {
      await expect(manager.ensureAppAuthorized('Example', 'example.app')).rejects.toThrow('未完成')
      expect(manager.checkAppAuthorization('Example', 'example.app')).toBe('pending')
      expect(manager.resolveAppAuth(requestId, 'always')).toBe(false)
    } finally { globalThis.setTimeout = original }
  })
  test('When 恢复单项询问 Then 重载后该项消失且其他决定保留', () => {
    const path = join(tmpdir(), `gamma-revoke-${randomUUID()}.json`)
    const manager = new ComputerAuthorizationManager(path)
    manager.recordAppDecision('One', 'always', 'app.one')
    manager.recordAppDecision('Two', 'denied', 'app.two')
    manager.updatePreferences({ allowedApps: { 'app.two': 'denied' } })
    const reloaded = new ComputerAuthorizationManager(path)
    expect(reloaded.checkAppAuthorization('One', 'app.one')).toBe('pending')
    expect(reloaded.checkAppAuthorization('Two', 'app.two')).toBe('denied')
    manager.updatePreferences({ shareObservations: true })
    manager.updatePreferences({ shareObservations: false })
    expect(new ComputerAuthorizationManager(path).getPreferences().shareObservations).toBe(false)
  })
})

test('Given 关闭应用授权弹窗或监听器故障 When 请求结束 Then 只取消本次且不持久拒绝', async () => {
  for (const broken of [false, true]) {
    const manager = new ComputerAuthorizationManager(join(tmpdir(), `gamma-dismiss-${randomUUID()}.json`))
    manager.onAppAuthRequested(request => {
      if (broken) throw new Error('UI断开')
      manager.resolveAppAuth(request.requestId, 'cancelled')
    })
    await expect(manager.ensureAppAuthorized('App', 'app.example')).rejects.toThrow('未完成')
    expect(manager.getPreferences().allowedApps).toEqual({})
  }
})
