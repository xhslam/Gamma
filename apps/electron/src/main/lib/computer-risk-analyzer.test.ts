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
        { bundleId: 'com.apple.Safari', role: 'AXTextField', description: 'Address and search bar', isTrustedSearch: true },
        'standard',
      )
      expect(typeRes.level).toBe('low')
      expect(typeRes.requiresConfirmation).toBe(false)

      const searchReturnRes = evaluateComputerRisk(
        { action: 'key', key: 'Return' },
        { bundleId: 'com.apple.Safari', role: 'AXTextField', description: 'Address and search bar', isTrustedSearch: true },
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
      expect(relaxedRes.requiresConfirmation).toBe(true)
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


describe('Given 风险策略边界回归', () => {
  test('When Safari 登录框回车 Then 不能因为浏览器是Safari就冒充搜索', () => {
    expect(evaluateComputerRisk({ action: 'key', key: 'Return' }, { bundleId: 'com.apple.Safari', role: 'AXTextField', description: '用户名' }).requiresConfirmation).toBe(true)
  })
  test('When 消息编辑区回车或快捷发送 Then 即便是AXTextArea也要确认', () => {
    for (const key of ['Return', 'cmd+Return', 'ctrl+Enter']) expect(evaluateComputerRisk({ action: 'key', key }, { bundleId: 'com.apple.MobileSMS', role: 'AXTextArea' }).requiresConfirmation).toBe(true)
  })
  test('When 点击任意应用的发送/提交 Then 三档都保留明确高风险确认', () => {
    for (const policy of ['strict', 'standard', 'relaxed'] as const) for (const title of ['提交', '发送', '支付', '删除']) expect(evaluateComputerRisk({ action: 'click' }, { role: 'AXButton', title, bundleId: 'com.example.web' }, policy).requiresConfirmation).toBe(true)
  })
  test('When 严格策略新建笔记 Then 确认；标准新建不确认，纯观察都不确认', () => {
    const context = { role: 'AXButton', title: '新建备忘录' }
    expect(evaluateComputerRisk({ action: 'click' }, context, 'strict').requiresConfirmation).toBe(true)
    expect(evaluateComputerRisk({ action: 'click' }, context, 'standard').requiresConfirmation).toBe(false)
    expect(evaluateComputerRisk({ action: 'screenshot' }, context, 'strict').requiresConfirmation).toBe(false)
  })
  test('When Cmd-Delete 或 Command+Backspace 别名 Then 仍识别删除', () => {
    for (const key of ['Cmd-Delete', 'Command+Backspace', 'super+alt+backspace']) expect(evaluateComputerRisk({ action: 'key', key }, { role: 'AXTextArea' }).requiresConfirmation).toBe(true)
  })
})

describe('Given AX 原生动作与工具动作的同等风险边界', () => {
  test('When 点击或辅助动作触发支付/删除/发送/提交 Then 每档策略与坐标点击同样确认', () => {
    for (const policy of ['strict', 'standard', 'relaxed'] as const) {
      for (const title of ['立即支付', '删除文件', '发送消息', '提交']) {
        const context = { role: 'AXButton', bundleId: 'com.example.app', title }
        const expected = evaluateComputerRisk({ action: 'click' }, context, policy)
        for (const action of ['axPress', 'perform_secondary_action', 'axAction']) {
          expect(evaluateComputerRisk({ action, secondaryAction: 'AXPress', elementRef: 'e1', observationId: 'o1' }, context, policy)).toEqual(expected)
        }
      }
    }
  })

  test('When 辅助动作名称本身指示高风险 Then 不能以中性控件标签掩盖风险', () => {
    for (const secondaryAction of ['AXDelete', 'AXSendMessage', 'AXPurchase', 'AXSubmit', 'delete_item']) {
      const risk = evaluateComputerRisk({ action: 'axAction', secondaryAction }, { role: 'AXButton', title: '选项' }, 'relaxed')
      expect(risk.level).toBe('high')
      expect(risk.requiresConfirmation).toBe(true)
    }
  })

  test('When 未知、缺失或仅知道动作名称但无法确定副作用 Then 宽松模式仍确认且不回显参数', () => {
    for (const secondaryAction of [undefined, 'AXUnknownPrivateAction', 'AXConfirm', 'AXIncrement']) {
      const risk = evaluateComputerRisk({ action: 'perform_secondary_action', secondaryAction }, { role: 'AXButton', title: '更多' }, 'relaxed')
      expect(risk.requiresConfirmation).toBe(true)
      expect(risk.reason).toBe('无法识别辅助 AX 动作的实际副作用')
    }
    for (const action of ['click', 'axPress', 'axSetValue', 'set_value', 'axFocus', 'focus', 'axSelectText', 'select_text', 'paste']) {
      expect(evaluateComputerRisk({ action, text: 'private' }, undefined, 'relaxed').requiresConfirmation).toBe(true)
    }
    expect(evaluateComputerRisk({ action: 'unknown_action' }, { role: 'AXButton' }, 'relaxed').requiresConfirmation).toBe(true)
  })

  test('When AX 原生或工具动作操作受保护系统应用 Then 不绕过认证', () => {
    for (const action of ['axPress', 'axSetValue', 'axFocus', 'axAction', 'axSelectText', 'set_value', 'focus', 'perform_secondary_action', 'select_text', 'paste', 'type_text', 'press_key']) {
      const risk = evaluateComputerRisk({ action, text: '内容', secondaryAction: 'AXShowMenu' }, { bundleId: 'com.apple.Terminal', role: 'AXTextArea' }, 'relaxed')
      expect(risk.level).toBe('high')
      expect(risk.authMethod).toBe('touch-id')
      expect(risk.requiresConfirmation).toBe(true)
    }
  })

  test('When 新文本动作或别名访问安全输入 Then 强制确认且理由不泄露内容', () => {
    const secret = 'private-test-input'
    for (const action of ['axSetValue', 'set_value', 'paste', 'type_text', 'axSelectText', 'select_text']) {
      const risk = evaluateComputerRisk({ action, text: secret, selectionText: secret, prefix: secret, suffix: secret }, { role: 'AXSecureTextField', isSecure: true }, 'relaxed')
      expect(risk.requiresConfirmation).toBe(true)
      expect(risk.authMethod).toBe('touch-id')
      expect(JSON.stringify(risk)).not.toContain(secret)
    }
    expect(evaluateComputerRisk({ action: 'press_key', key: 'Command+Delete' }, { role: 'AXTextArea' }, 'relaxed').level).toBe('high')
  })

  test('When 值替换直接作用在危险控件 Then 不以文本动作名绕过删除、发送和支付检查', () => {
    for (const action of ['set_value', 'axSetValue']) for (const title of ['支付', '删除', '发送', '提交']) {
      expect(evaluateComputerRisk({ action, text: 'true' }, { role: 'AXCheckBox', title }, 'relaxed').level).toBe('high')
    }
  })

  test('When 在普通笔记编辑区设置值、定位和粘贴 Then 标准策略放行而严格策略确认', () => {
    const context = { bundleId: 'com.apple.Notes', role: 'AXTextArea', title: '笔记正文' }
    for (const action of ['axSetValue', 'set_value', 'axFocus', 'focus', 'axSelectText', 'select_text', 'paste', 'type_text']) {
      expect(evaluateComputerRisk({ action, text: '第一行\n第二行' }, context).requiresConfirmation).toBe(false)
      expect(evaluateComputerRisk({ action, text: '第一行\n第二行' }, context, 'strict').requiresConfirmation).toBe(true)
    }
    for (const action of ['get_app_state', 'list_apps']) {
      expect(evaluateComputerRisk({ action }, undefined, 'strict').requiresConfirmation).toBe(false)
    }
  })
})

describe('Given 通讯应用中的粘贴与多行输入', () => {
  test('When 所有粘贴格式包含多行 Then 宽松策略也保守确认', () => {
    const context = { bundleId: 'com.tencent.xinWeChat', role: 'AXTextArea' }
    for (const format of ['text', 'md', 'html'] as const) for (const text of ['第一行\n第二行', '第一行\r第二行', '第一行\u2028第二行']) {
      const risk = evaluateComputerRisk({ action: 'paste', format, text }, context, 'relaxed')
      expect(risk.level).toBe('high')
      expect(risk.requiresConfirmation).toBe(true)
      expect(risk.reason).not.toContain(text)
    }
  })

  test('When HTML 标签或实体隐含换行 Then 不以源码单行作为安全依据', () => {
    for (const format of ['md', 'html'] as const) for (const text of ['<p>第一段</p><p>第二段</p>', '<div>第一段<div>第二段', '第一行<br>第二行', '第一行&#10;第二行', '第一行&#13;第二行', '第一行&#xD;第二行', '第一行&NewLine;第二行']) {
      expect(evaluateComputerRisk({ action: 'paste', format, text }, { bundleId: 'com.apple.Mail', role: 'AXTextArea' }, 'relaxed').requiresConfirmation).toBe(true)
    }
  })

  test('When 别名输入或设置值包含换行 Then 仍保留通讯发送风险；单行普通文本放行', () => {
    const context = { bundleId: 'com.apple.MobileSMS', role: 'AXTextArea' }
    for (const action of ['type', 'type_text', 'set_value', 'axSetValue', 'paste']) {
      expect(evaluateComputerRisk({ action, text: '第一行\n第二行' }, context, 'relaxed').requiresConfirmation).toBe(true)
      expect(evaluateComputerRisk({ action, text: '草稿' }, context).requiresConfirmation).toBe(false)
    }
    expect(evaluateComputerRisk({ action: 'press_key', key: 'Return' }, context, 'relaxed').requiresConfirmation).toBe(true)
  })
})
