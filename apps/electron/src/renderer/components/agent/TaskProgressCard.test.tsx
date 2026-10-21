import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { TaskProgressCard } from './TaskProgressCard'

const activities: ToolActivity[] = [{
  toolUseId: 'update-verify',
  toolName: 'TaskUpdate',
  input: { taskId: 'verify', subject: '验证实现', status: 'in_progress', activeForm: '正在运行测试' },
  done: true,
}]

describe('任务进度卡的执行状态', () => {
  test('given a live stage when rendering then shows its active action and spinner', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={activities} />)
    expect(html).toContain('正在运行测试')
    expect(html).toContain('animate-spin')
  })

  test('given the run has stopped when rendering then keeps unfinished work without claiming it is still running', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={activities} streamEnded />)
    expect(html).toContain('验证实现')
    expect(html).not.toContain('正在运行测试')
    expect(html).not.toContain('animate-spin')
    expect(html).toContain('0/1')
  })
})

describe('任务进度卡的完整阶段列表', () => {
  test('given 三个独立阶段 when 渲染任务进度 then 显示三项和 1/3 而非 0/1', () => {
    const tasks = [
      { id: 'research', subject: '排查原因', status: 'completed' },
      { id: 'fix', subject: '实现修复', status: 'in_progress', activeForm: '正在修改代码' },
      { id: 'verify', subject: '回归验证', status: 'pending' },
    ]
    const html = renderToStaticMarkup(<TaskProgressCard alwaysExpanded activities={tasks.map((task) => ({
      toolUseId: `create-${task.id}`, toolName: 'TaskCreate', input: { subject: task.subject }, done: true,
      result: JSON.stringify({ task }),
    }))} />)
    expect(html).toContain('排查原因')
    expect(html).toContain('正在修改代码')
    expect(html).toContain('回归验证')
    expect(html).toContain('1/3')
    expect(html).not.toContain('0/1')
  })
})
