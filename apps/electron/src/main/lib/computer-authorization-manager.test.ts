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

  test('初始偏好包含默认受信任应用（备忘录），风险策略默认为 standard', () => {
    const prefs = manager.getPreferences()
    expect(prefs.riskPolicy).toBe('standard')
    expect(prefs.allowedApps['notes']).toBe('always')
    expect(prefs.allowedApps['备忘录']).toBe('always')
    expect(manager.checkAppAuthorization('Notes')).toBe('allowed')
    expect(manager.checkAppAuthorization('备忘录')).toBe('allowed')
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
    expect(manager.checkAppAuthorization('Safari')).toBe('allowed')
    expect(manager.checkAppAuthorization('com.apple.Safari')).toBe('allowed')

    // 新建 manager 实例模拟重启后，持久化决策依然生效
    const newManager = new ComputerAuthorizationManager(tempConfigFile)
    expect(newManager.checkAppAuthorization('Safari')).toBe('allowed')
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
