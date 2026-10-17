import type { ComputerAXContext, ComputerRiskLevel, ComputerRiskPolicy } from '@gamma/shared'
import type { ComputerExecuteParams } from './computer-controller'

export interface RiskEvaluationResult {
  level: ComputerRiskLevel
  requiresConfirmation: boolean
  reason: string
  authMethod: 'touch-id' | 'dialog'
}

const PAYMENT_KEYWORDS = ['支付', '付款', '购买', '充值', '结算', 'pay', 'purchase', 'buy', 'checkout']
const DESTRUCTIVE_KEYWORDS = ['删除', '移除', '清空', '销毁', '格式化', 'delete', 'remove', 'trash', 'format', 'erase']
const SENDING_KEYWORDS = ['发送', '群发', 'send', 'dispatch']
const SUBMIT_KEYWORDS = ['提交', 'submit']

const HIGH_RISK_SYSTEM_APPS = new Set([
  'com.apple.systempreferences',
  'com.apple.Terminal',
  'com.apple.keychainaccess',
  'com.apple.DiskUtility',
])

const COMMUNICATION_APPS = new Set([
  'com.tencent.xinWeChat',
  'com.larksuite.lark',
  'com.apple.MobileSMS',
  'com.apple.mail',
  'com.tinyspeck.slackmacgap',
  'org.whispersystems.signal-desktop',
  'com.hnc.Discord',
])

function containsKeyword(text: string | undefined, keywords: string[]): string | undefined {
  if (!text) return undefined
  const lower = text.toLowerCase()
  return keywords.find((k) => lower.includes(k.toLowerCase()))
}

/**
 * 结合当前动作、AX 上下文与安全策略，判定操作风险等级与是否需要人工确认。
 */
export function evaluateComputerRisk(
  params: ComputerExecuteParams,
  axContext: ComputerAXContext | undefined,
  policy: ComputerRiskPolicy = 'standard',
): RiskEvaluationResult {
  const actionKind = (params.action ?? '').trim().toLowerCase()
  const role = (axContext?.role ?? '').trim()
  const subrole = (axContext?.subrole ?? '').trim().toLowerCase()
  const title = (axContext?.title ?? '').trim()
  const desc = (axContext?.description ?? '').trim()
  const bundleId = (axContext?.bundleId ?? '').trim()
  const elementText = `${title} ${desc}`.trim()

  const isSecureField =
    axContext?.isSecure === true ||
    role === 'AXSecureTextField' ||
    subrole === 'axsecuretextfield' ||
    subrole.includes('secure') ||
    subrole.includes('password')

  // 1. 密码输入：无论何种策略，凡是密码框输入均属于高风险
  if (isSecureField && (actionKind === 'type' || actionKind === 'key')) {
    return {
      level: 'high',
      requiresConfirmation: true,
      reason: '检测到安全凭据与密码输入控件 (AXSecureTextField)',
      authMethod: 'touch-id',
    }
  }

  // 2. 系统核心设置修改应用：在系统设置/终端中进行写操作
  if (bundleId && HIGH_RISK_SYSTEM_APPS.has(bundleId) && ['click', 'double_click', 'type', 'key'].includes(actionKind)) {
    return {
      level: 'high',
      requiresConfirmation: true,
      reason: `检测到受保护的系统核心应用操作 (${axContext?.appName || bundleId})`,
      authMethod: 'touch-id',
    }
  }

  // 3. 点击或触发按钮判定
  if (actionKind === 'click' || actionKind === 'double_click' || actionKind === 'left_click') {
    const payWord = containsKeyword(elementText, PAYMENT_KEYWORDS)
    if (payWord) {
      return {
        level: 'high',
        requiresConfirmation: true,
        reason: `检测到涉及资金交易与支付的操作: "${payWord}"`,
        authMethod: 'touch-id',
      }
    }

    const deleteWord = containsKeyword(elementText, DESTRUCTIVE_KEYWORDS)
    if (deleteWord) {
      return {
        level: 'high',
        requiresConfirmation: true,
        reason: `检测到涉及删除与清空数据的操作: "${deleteWord}"`,
        authMethod: 'touch-id',
      }
    }

    const sendWord = containsKeyword(elementText, SENDING_KEYWORDS)
    if (sendWord && (COMMUNICATION_APPS.has(bundleId) || policy === 'strict')) {
      return {
        level: 'high',
        requiresConfirmation: policy !== 'relaxed',
        reason: `检测到对外发送消息或邮件的操作: "${sendWord}"`,
        authMethod: 'dialog',
      }
    }

    const submitWord = containsKeyword(elementText, SUBMIT_KEYWORDS)
    if (submitWord && policy === 'strict') {
      return {
        level: 'medium',
        requiresConfirmation: true,
        reason: `检测到表单全局提交操作: "${submitWord}"`,
        authMethod: 'dialog',
      }
    }
  }

  // 4. 按键操作（重点关注回车与破坏性快捷键）
  if (actionKind === 'key') {
    const key = (params.key ?? params.text ?? '').trim().toLowerCase()

    // 快捷键删除：Cmd+Delete / Cmd+Backspace
    if (key === 'cmd+delete' || key === 'cmd+backspace') {
      return {
        level: 'high',
        requiresConfirmation: true,
        reason: '检测到快捷键删除操作 (Cmd+Delete)',
        authMethod: 'touch-id',
      }
    }

    // 回车键判定：区分搜索/普通编辑换行 vs 敏感表单/按钮确认
    if (key === 'return' || key === 'enter') {
      // 场景 A: 文档编辑区普通换行（如备忘录正文 AXTextArea / AXScrollArea）
      if (role === 'AXTextArea' || role === 'AXScrollArea') {
        return {
          level: 'low',
          requiresConfirmation: false,
          reason: '文本或文档编辑区回车换行',
          authMethod: 'dialog',
        }
      }

      // 场景 B: 浏览器地址栏或搜索输入框（如 Safari URL 栏 AXTextField）
      const isSearchOrUrlBar =
        role === 'AXTextField' &&
        (desc.toLowerCase().includes('search') ||
          desc.toLowerCase().includes('address') ||
          desc.toLowerCase().includes('url') ||
          title.toLowerCase().includes('search') ||
          title.toLowerCase().includes('搜索') ||
          bundleId === 'com.apple.Safari')

      if (isSearchOrUrlBar) {
        return {
          level: 'low',
          requiresConfirmation: false,
          reason: '搜索框或地址栏回车导航',
          authMethod: 'dialog',
        }
      }

      // 场景 C: 当前焦点在支付/删除/发送按钮上时按回车
      const payWord = containsKeyword(elementText, PAYMENT_KEYWORDS)
      if (payWord) {
        return {
          level: 'high',
          requiresConfirmation: true,
          reason: `在支付元素上按回车确认: "${payWord}"`,
          authMethod: 'touch-id',
        }
      }

      const deleteWord = containsKeyword(elementText, DESTRUCTIVE_KEYWORDS)
      if (deleteWord) {
        return {
          level: 'high',
          requiresConfirmation: true,
          reason: `在删除元素上按回车确认: "${deleteWord}"`,
          authMethod: 'touch-id',
        }
      }

      const sendWord = containsKeyword(elementText, SENDING_KEYWORDS)
      if (sendWord && COMMUNICATION_APPS.has(bundleId)) {
        return {
          level: 'high',
          requiresConfirmation: policy !== 'relaxed',
          reason: `在消息元素上按回车发送: "${sendWord}"`,
          authMethod: 'dialog',
        }
      }
    }
  }

  // 5. 默认行为：常规低风险日常操作（观察、输入、滚动、普通点击）
  return {
    level: 'low',
    requiresConfirmation: false,
    reason: '常规低风险桌面操作',
    authMethod: 'dialog',
  }
}
