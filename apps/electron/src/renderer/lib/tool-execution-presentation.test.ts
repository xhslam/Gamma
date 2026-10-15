import { describe, expect, test } from 'bun:test'
import { getToolExecutionPresentation } from './tool-execution-presentation'

describe('Given 真实工具结果与审批证据', () => {
  test('When 等待审批或提交审批 Then 不得显示工具成功', () => {
    expect(getToolExecutionPresentation({ approval: 'pending', isStreaming: true }).status).toBe('pending')
    expect(getToolExecutionPresentation({ approval: 'submitting', isStreaming: true }).status).toBe('approval-submitting')
    expect(getToolExecutionPresentation({ isStreaming: true }).status).toBe('running')
  })
  test('When 收到空成功结果 Then 仍然是已完成，而非继续等待', () => {
    expect(getToolExecutionPresentation({ result: { result: '' } }).status).toBe('success')
  })
  test('When 错误结果含权限服务精确哨兵 Then 区分拒绝、取消与异常', () => {
    expect(getToolExecutionPresentation({ result: { result: '用户拒绝了此操作', isError: true } }).status).toBe('denied')
    expect(getToolExecutionPresentation({ result: { result: 'Error: 操作已中止', isError: true } }).status).toBe('cancelled')
    expect(getToolExecutionPresentation({ result: { result: '文件不存在', isError: true } }).status).toBe('error')
    expect(getToolExecutionPresentation({ result: { result: '会话已结束', isError: true } }).status).toBe('error')
  })
  test('When 任意输出包含拒绝文字但非权限拒绝 Then 不伪造拒绝或取消', () => {
    expect(getToolExecutionPresentation({ result: { result: '日志：用户拒绝了此操作', isError: true } }).status).toBe('error')
    expect(getToolExecutionPresentation({ result: { result: '用户拒绝了此操作', isError: false } }).status).toBe('success')
  })
  test('When 会话终止或恢复时缺失结果 Then 保留未知，不把未运行/断线推断为成功或取消', () => {
    expect(getToolExecutionPresentation({ isStreaming: false }).status).toBe('unknown')
    expect(getToolExecutionPresentation({}).status).toBe('unknown')
  })
  test('When 真实结果晚到或重放 Then 结果优先于陈旧审批状态', () => {
    expect(getToolExecutionPresentation({ approval: 'pending', result: { result: '', isError: false } }).status).toBe('success')
    expect(getToolExecutionPresentation({ approval: 'submitting', result: { result: '用户拒绝了此操作', isError: true } }).status).toBe('denied')
  })
})
