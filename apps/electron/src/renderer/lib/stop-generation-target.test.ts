import { afterEach, describe, expect, test } from 'bun:test'
import { clearStopGenerationTarget, getLastInteractedStopTarget, getStopGenerationTarget, rememberStopGenerationTarget, resolveStopGenerationTarget } from './stop-generation-target'

afterEach(() => {
  const target = getLastInteractedStopTarget()
  if (target) clearStopGenerationTarget(target)
})
describe('Given 外部 agy 任务和父 Pi 会话同时运行', () => {
  test('When 活动右侧标签为 agy Then 全局停止不得回退为父会话', () => {
    expect(resolveStopGenerationTarget({ type: 'agent', sessionId: 'parent' }, 'agy:task')).toEqual({ kind: 'agy', sessionId: 'parent', taskId: 'task' })
    expect(resolveStopGenerationTarget({ type: 'agent', sessionId: 'parent' }, 'files')).toEqual({ kind: 'agent', sessionId: 'parent' })
  })
  test('When 其他任务卸载 Then 不清除仍然交互中的任务目标', () => {
    const target = { kind: 'agy' as const, sessionId: 'parent', taskId: 'one' }
    rememberStopGenerationTarget(target)
    clearStopGenerationTarget({ kind: 'agy', sessionId: 'parent', taskId: 'two' })
    clearStopGenerationTarget({ kind: 'agent', sessionId: 'parent' })
    expect(getLastInteractedStopTarget()).toEqual(target)
    clearStopGenerationTarget(target)
    expect(getLastInteractedStopTarget()).toBeNull()
  })
  test('When 事件缺少 agy taskId Then 拒绝停止，而不是误停父会话', () => {
    expect(getStopGenerationTarget(new CustomEvent('stop', { detail: { kind: 'agy', sessionId: 'parent' } }))).toBeNull()
    expect(getStopGenerationTarget(new CustomEvent('stop', { detail: { kind: 'agy', sessionId: 'parent', taskId: 'one' } }))).toEqual({ kind: 'agy', sessionId: 'parent', taskId: 'one' })
    expect(getStopGenerationTarget(new CustomEvent('stop', { detail: { kind: 'agent', sessionId: 'parent' } }))).toEqual({ kind: 'agent', sessionId: 'parent' })
  })
})
