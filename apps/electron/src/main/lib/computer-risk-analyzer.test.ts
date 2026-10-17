import { describe, expect, test } from 'bun:test'
import { evaluateComputerRisk } from './computer-risk-analyzer'

describe('computer-risk-analyzer 风险评估引擎', () => {
  describe('验收用例保障（绝对不误拦截）', () => {
    test('用例 1: 备忘录编辑正文与换行 -> 低风险，零拦截', () => {
      const typeRes = evaluateComputerRisk(
        { action: 'type', text: '测试' },
        { bundleId: 'com.apple.Notes', role: 'AXTextArea', title: '', description: 'Notes body' },
        'standard',
      )
      expect(typeRes.level).toBe('low')
      expect(typeRes.requiresConfirmation).toBe(false)

      const returnRes = evaluateComputerRisk(
        { action: 'key', key: 'Return' },
        { bundleId: 'com.apple.Notes', role: 'AXTextArea', title: '', description: 'Notes body' },
        'standard',
      )
      expect(returnRes.level).toBe('low')
      expect(returnRes.requiresConfirmation).toBe(false)
    })

    test('用例 2: Safari 地址栏输入与回车搜索 -> 低风险，零拦截', () => {
      const typeRes = evaluateComputerRisk(
        { action: 'type', text: '今天的天气' },
        { bundleId: 'com.apple.Safari', role: 'AXTextField', description: 'Address and search bar' },
        'standard',
      )
      expect(typeRes.level).toBe('low')
      expect(typeRes.requiresConfirmation).toBe(false)

      const searchReturnRes = evaluateComputerRisk(
        { action: 'key', key: 'Return' },
        { bundleId: 'com.apple.Safari', role: 'AXTextField', description: 'Address and search bar' },
        'standard',
      )
      expect(searchReturnRes.level).toBe('low')
      expect(searchReturnRes.requiresConfirmation).toBe(false)
    })
  })

  describe('高风险场景判定（拦截并要求生物认证/确认）', () => {
    test('密码字段输入 (AXSecureTextField) -> 强制高风险', () => {
      const res = evaluateComputerRisk(
        { action: 'type', text: 'mypassword123' },
        { bundleId: 'com.example.login', role: 'AXSecureTextField', isSecure: true },
        'relaxed', // 即便宽松模式也拦截密码输入
      )
      expect(res.level).toBe('high')
      expect(res.requiresConfirmation).toBe(true)
      expect(res.authMethod).toBe('touch-id')
    })

    test('支付类按钮点击 -> 强制高风险', () => {
      const res = evaluateComputerRisk(
        { action: 'click', coordinate: [100, 200] },
        { bundleId: 'com.apple.Safari', role: 'AXButton', title: '立即支付 99 元' },
        'standard',
      )
      expect(res.level).toBe('high')
      expect(res.requiresConfirmation).toBe(true)
      expect(res.reason).toContain('资金交易')
    })

    test('删除类按钮点击 -> 强制高风险', () => {
      const res = evaluateComputerRisk(
        { action: 'click', coordinate: [100, 200] },
        { bundleId: 'com.apple.finder', role: 'AXButton', title: '清空废纸篓' },
        'standard',
      )
      expect(res.level).toBe('high')
      expect(res.requiresConfirmation).toBe(true)
      expect(res.reason).toContain('删除与清空')
    })

    test('快捷键删除 (Cmd+Delete) -> 强制高风险', () => {
      const res = evaluateComputerRisk(
        { action: 'key', key: 'cmd+delete' },
        { bundleId: 'com.apple.finder', role: 'AXScrollArea' },
        'standard',
      )
      expect(res.level).toBe('high')
      expect(res.requiresConfirmation).toBe(true)
    })

    test('通讯应用点击发送按钮 -> 标准与严格模式拦截', () => {
      const standardRes = evaluateComputerRisk(
        { action: 'click', coordinate: [500, 600] },
        { bundleId: 'com.tencent.xinWeChat', role: 'AXButton', title: '发送' },
        'standard',
      )
      expect(standardRes.level).toBe('high')
      expect(standardRes.requiresConfirmation).toBe(true)

      const relaxedRes = evaluateComputerRisk(
        { action: 'click', coordinate: [500, 600] },
        { bundleId: 'com.tencent.xinWeChat', role: 'AXButton', title: '发送' },
        'relaxed',
      )
      expect(relaxedRes.requiresConfirmation).toBe(false)
    })

    test('系统设置应用核心配置写操作 -> 强制高风险', () => {
      const res = evaluateComputerRisk(
        { action: 'click', coordinate: [300, 400] },
        { bundleId: 'com.apple.systempreferences', role: 'AXButton', title: '关闭防火墙' },
        'standard',
      )
      expect(res.level).toBe('high')
      expect(res.requiresConfirmation).toBe(true)
    })
  })

  describe('日常低风险操作放行', () => {
    test('普通按钮（新建、下一步、取消、确定）-> 直接放行', () => {
      const newBtn = evaluateComputerRisk(
        { action: 'click' },
        { bundleId: 'com.apple.Notes', role: 'AXButton', title: '新建备忘录' },
        'standard',
      )
      expect(newBtn.requiresConfirmation).toBe(false)

      const cancelBtn = evaluateComputerRisk(
        { action: 'click' },
        { bundleId: 'com.example.app', role: 'AXButton', title: '取消' },
        'standard',
      )
      expect(cancelBtn.requiresConfirmation).toBe(false)
    })

    test('截屏与滚动与等待 -> 直接放行', () => {
      expect(evaluateComputerRisk({ action: 'screenshot' }, undefined).requiresConfirmation).toBe(false)
      expect(evaluateComputerRisk({ action: 'scroll', delta_y: -200 }, undefined).requiresConfirmation).toBe(false)
      expect(evaluateComputerRisk({ action: 'wait', duration: 1 }, undefined).requiresConfirmation).toBe(false)
    })
  })
})
