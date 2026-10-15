import { describe, expect, test } from 'bun:test'
import { canResumeConversationFollow, getConversationScrollDistance, isConversationScrollKey } from './conversation-scroll-policy'

describe('Given 会话滚动产品阈值', () => {
  test('When 内容不足或发生回弹 Then 距底部不为负数', () => {
    expect(getConversationScrollDistance(200, 400, 0)).toBe(0)
    expect(getConversationScrollDistance(1000, 400, -20)).toBe(600)
    expect(getConversationScrollDistance(1000, 400, 601)).toBe(0)
  })
  test('When 用户向下回到底部且冷却结束 Then 才允许恢复跟随', () => {
    expect(canResumeConversationFollow(40, 150, true)).toBe(true)
    expect(canResumeConversationFollow(41, 150, true)).toBe(false)
    expect(canResumeConversationFollow(0, 149, true)).toBe(false)
    expect(canResumeConversationFollow(20, 1000, false)).toBe(false)
  })
  test('When 使用导航键而非编辑快捷键 Then 识别用户滚动意图', () => {
    const modifiers = { ctrlKey: false, metaKey: false, altKey: false }
    expect(isConversationScrollKey({ key: 'PageUp', ...modifiers })).toBe(true)
    expect(isConversationScrollKey({ key: 'Enter', ...modifiers })).toBe(false)
    expect(isConversationScrollKey({ key: 'Home', ...modifiers, metaKey: true })).toBe(false)
  })
})
