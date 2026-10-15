import { describe, expect, test } from 'bun:test'
import { createAgentSendGuard, getAgentSendRecoveryState, isAgentDraftUnchanged } from './agent-send-draft-recovery'

const draft = { text: '', html: '', editVersion: 1, syncVersion: 2 }
describe('Given 清空后等待发送 IPC 的草稿', () => {
  test('When 用户没有编辑 Then 可自动恢复包含引用 HTML 的原始快照', () => {
    expect(isAgentDraftUnchanged(draft, { ...draft })).toBe(true)
  })
  test('When 新草稿未停顿同步、文本相同或外部回填 Then 都不可覆盖', () => {
    expect(isAgentDraftUnchanged(draft, { ...draft, editVersion: 2 })).toBe(false)
    expect(isAgentDraftUnchanged(draft, { ...draft, text: '新消息' })).toBe(false)
    expect(isAgentDraftUnchanged(draft, { ...draft, html: '<p>引用</p>' })).toBe(false)
    expect(isAgentDraftUnchanged(draft, { ...draft, syncVersion: 3 })).toBe(false)
  })
  test('When 重复点击及旧请求晚到 Then 同会话只提交一次且不解锁新请求', () => {
    const guard = createAgentSendGuard()
    const first = guard.begin('a')!
    expect(guard.begin('a')).toBeNull()
    expect(guard.begin('b')).not.toBeNull()
    guard.finish('a', first)
    const second = guard.begin('a')!
    guard.finish('a', first)
    expect(guard.begin('a')).toBeNull()
    guard.finish('a', second)
    expect(guard.begin('a')).not.toBeNull()
  })
  test('When 同 store 重挂载或多个输入实例 Then 共享提交锁，但不同 store 隔离', () => {
    const scope = {}
    const first = getAgentSendRecoveryState(scope)
    first.guard.begin('a')
    first.draftEditVersions.set('a', 3)
    const remounted = getAgentSendRecoveryState(scope)
    expect(remounted.guard.isPending('a')).toBe(true)
    expect(remounted.draftEditVersions.get('a')).toBe(3)
    expect(getAgentSendRecoveryState({}).guard.isPending('a')).toBe(false)
  })

})
