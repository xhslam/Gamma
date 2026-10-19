import type { ComputerAXContext, ComputerRiskLevel, ComputerRiskPolicy } from '@gamma/shared'
import type { ComputerExecuteParams } from './computer-controller'

export interface RiskEvaluationResult {
  level: ComputerRiskLevel
  requiresConfirmation: boolean
  reason: string
  authMethod: 'touch-id' | 'dialog'
}
const PAYMENT = ['支付', '付款', '购买', '充值', '结算', 'pay', 'purchase', 'buy', 'checkout']
const DELETE = ['删除', '移除', '清空', '销毁', '格式化', 'delete', 'remove', 'trash', 'format', 'erase']
const SEND = ['发送', '群发', '发布', 'send', 'dispatch', 'publish', 'post']
const SUBMIT = ['提交', '确认订单', 'submit', 'place order']
const SYSTEM = new Set(['com.apple.systempreferences', 'com.apple.terminal', 'com.apple.keychainaccess', 'com.apple.diskutility'])
const COMMUNICATION = new Set(['com.tencent.xinwechat', 'com.larksuite.lark', 'com.apple.mobilesms', 'com.apple.mail', 'com.tinyspeck.slackmacgap', 'org.whispersystems.signal-desktop', 'com.hnc.discord'])
const KNOWN_SECONDARY_ACTIONS = new Set(['axpress', 'axshowmenu', 'axraise', 'axcancel'])
function keyword(text: string, words: string[]): string | undefined {
  const lower = text.toLowerCase()
  return words.find(word => /[a-z]/i.test(word) ? new RegExp(`\\b${word}\\b`, 'i').test(lower) : lower.includes(word))
}
const result = (level: ComputerRiskLevel, reason: string, confirm: boolean, touch = false): RiskEvaluationResult => ({ level, reason, requiresConfirmation: confirm, authMethod: touch ? 'touch-id' : 'dialog' })

/** 仅使用 native 命中控件/焦点上下文，不能把整棵 AX 树或模型自报意图当作授权；不回显或持久化输入内容。 */
export function evaluateComputerRisk(params: ComputerExecuteParams, context: ComputerAXContext | undefined, policy: ComputerRiskPolicy = 'standard'): RiskEvaluationResult {
  const rawKind = (params.action ?? '').trim().toLowerCase()
  const aliases: Record<string, string> = { type_text: 'type', press_key: 'key', axpress: 'click', axsetvalue: 'set_value', axfocus: 'focus', axaction: 'perform_secondary_action', axselecttext: 'select_text' }
  const kind = aliases[rawKind] ?? rawKind
  const role = context?.role ?? ''
  const subrole = (context?.subrole ?? '').toLowerCase()
  const bundle = (context?.bundleId ?? '').toLowerCase()
  const secondary = kind === 'perform_secondary_action'
  // 动作名只能增加风险，不能作为用户授权或代替 native 控件上下文。
  const secondaryName = secondary ? (params.secondaryAction ?? '').trim() : ''
  const secondaryLabel = secondaryName.replace(/^AX/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
  const label = `${context?.title ?? ''} ${context?.description ?? ''} ${secondaryLabel}`.trim()
  const key = (params.key ?? params.text ?? '').toLowerCase().replace(/command|super/g, 'cmd').replace(/control/g, 'ctrl').replace(/option|opt/g, 'alt').replace(/-/g, '+').replace(/\s/g, '')
  const parts = key.split('+')
  const enter = parts.includes('enter') || parts.includes('return')
  const pointer = ['click', 'double_click', 'triple_click', 'left_click', 'right_click', 'middle_click', 'drag', 'left_click_drag'].includes(kind) || secondary
  const typing = ['type', 'key', 'set_value', 'paste'].includes(kind)
  const targeting = kind === 'focus' || kind === 'select_text'
  const readOnly = ['screenshot', 'get_app_state', 'list_apps', 'list_windows', 'wait', 'mouse_move', 'move'].includes(kind)
  if (readOnly) return result('low', '只读观察、指针移动或等待', false)
  if ((typing || kind === 'select_text') && (context?.isSecure || role === 'AXSecureTextField' || subrole.includes('secure') || subrole.includes('password'))) return result('high', '检测到安全凭据与密码输入控件', true, true)
  if (SYSTEM.has(bundle) && (pointer || typing || targeting || kind === 'scroll')) return result('high', '受保护系统应用中的写操作或设置修改', true, true)
  if (kind === 'key' && parts.includes('cmd') && (parts.includes('delete') || parts.includes('backspace'))) return result('high', '检测到快捷键删除操作', true, true)
  if (pointer || kind === 'set_value' || (kind === 'key' && (enter || key === 'space'))) {
    const pay = keyword(label, PAYMENT)
    if (pay) return result('high', `涉及资金交易与支付的操作：${pay}`, true, true)
    const remove = keyword(label, DELETE)
    if (remove) return result('high', `涉及删除与清空数据的操作：${remove}`, true, true)
    const send = keyword(label, SEND)
    if (send) return result('high', `对外发送或发布操作：${send}`, true)
    const submit = keyword(label, SUBMIT)
    if (submit) return result('high', `提交表单或订单：${submit}`, true)
  }
  if (secondary && !KNOWN_SECONDARY_ACTIONS.has(secondaryName.toLowerCase())) return result('medium', '无法识别辅助 AX 动作的实际副作用', true)
  // HTML 可以通过标签或实体产生换行；不将输入内容写进确认理由。
  const multiline = /[\r\n\u2028\u2029]/.test(params.text ?? '')
    || (kind === 'paste' && (params.format === 'html' || (params.format === 'md' && /<\/?(?:br|p|div|li|tr|h[1-6]|pre|blockquote|table|ul|ol)\b|&(?:#0*(?:10|13)|#x0*[ad]|NewLine);/i.test(params.text ?? ''))))
  if (['type', 'set_value', 'paste'].includes(kind) && COMMUNICATION.has(bundle) && multiline) return result('high', '通讯应用中的多行或富文本输入可能触发发送', true)
  if (kind === 'key' && COMMUNICATION.has(bundle) && (enter || (parts.includes('cmd') && parts.includes('shift') && parts.includes('d')))) return result('high', '通讯应用回车或发送快捷键可能发送消息/邮件', true)
  if (kind === 'key' && enter) {
    const hasModifier = parts.some(part => ['cmd', 'ctrl', 'alt'].includes(part))
    if (!hasModifier && role === 'AXTextArea' && ['com.apple.notes', 'com.apple.textedit', 'com.apple.iwork.pages'].includes(bundle)) return result('low', '文档编辑区回车换行', policy === 'strict')
    // 不能以“当前是 Safari”推断所有文本框都是地址栏，登录/支付表单同样在浏览器内。
    const search = !hasModifier && context?.isTrustedSearch === true && (role === 'AXSearchField' || role === 'AXTextField')
    if (search) return result('low', '搜索框或地址栏回车导航', policy === 'strict')
    return result('high', '回车可能提交表单或确认当前操作，无法判定为普通搜索/换行', true)
  }
  if (policy === 'strict') return result('medium', '严格策略：所有非只读动作执行前确认', true)
  if ((pointer || typing || targeting) && (!role || role.toLowerCase() === 'unknown')) return result('medium', '无法识别实际控件副作用', true)
  if (!pointer && !typing && !targeting && !['scroll', 'open_app', 'focus_window'].includes(kind)) return result('medium', '无法识别桌面动作的实际副作用', true)
  return result('low', '常规低风险桌面操作', false)
}
