import { describe, expect, test } from 'bun:test'
import { resolveAgyPermission } from './agy-permission-policy'

describe('Given agy 外部执行独立权限边界', () => {
  test('When 计划或无人值守来源请求启动 Then 拒绝而非落入普通工具放行', () => {
    expect(resolveAgyPermission('AgyStart', 'plan')).toBe('deny-plan')
    for (const source of ['automation', 'delegation', 'external']) expect(resolveAgyPermission('AgyStart', 'bypassPermissions', source)).toBe('deny-unattended')
  })
  test('When 主会话启动 Then 默认来源与完全自动模式均要求单次外派确认', () => {
    expect(resolveAgyPermission('AgyStart', 'bypassPermissions')).toBe('single-approval')
    expect(resolveAgyPermission('AgyStart', 'bypassPermissions', 'user')).toBe('single-approval')
  })
  test('When 读取、等待或安全停止 Then 计划模式也能收敛已有任务', () => {
    for (const name of ['AgyList', 'AgyRead', 'AgyWait', 'AgyStop']) expect(resolveAgyPermission(name, 'plan')).toBe('allow')
    expect(resolveAgyPermission('Bash', 'bypassPermissions')).toBe('unrelated')
  })
})
