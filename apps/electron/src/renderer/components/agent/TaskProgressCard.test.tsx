import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { TaskProgressCard } from './TaskProgressCard'

function activity(id: string, status: string, description?: string): ToolActivity {
  return {
    toolUseId: `update-${id}`, toolName: 'TaskUpdate', done: true,
    input: { taskId: id, subject: `阶段 ${id}`, status, activeForm: '正在运行测试', ...(description && { description }) },
  }
}

describe('Given 极简计划清单', () => {
  test('When 渲染正在执行的阶段 Then 只显示稳定任务名和完整细线圆，不增加状态文字与计数', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={[activity('verify', 'in_progress')]} />)
    expect(html).toContain('阶段 verify')
    expect(html).toContain('data-plan-status="in_progress"')
    expect(html).not.toMatch(/正在运行测试|任务进度|0\/1|animate-spin|line-through|lucide/)
  })

  test('When 执行停止 Then 保留真实未完成状态而不修改任务名或增加转圈动画', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={[activity('verify', 'in_progress')]} streamEnded />)
    expect(html).toContain('阶段 verify')
    expect(html).toContain('data-plan-status="in_progress"')
    expect(html).not.toContain('正在运行测试')
    expect(html).not.toContain('animate-spin')
  })

  test('When 计划超过八项 Then 全部以圆圈加一行任务名展示，不放标题、进度条和展开按钮', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={Array.from({ length: 10 }, (_, i) => activity(String(i), i === 0 ? 'completed' : 'pending'))} />)
    expect(html.match(/data-plan-row=""/g)).toHaveLength(10)
    expect(html).toContain('阶段 9')
    expect(html).not.toMatch(/任务进度|展开全部|<button|1\/10|shadow|border-dashed/)
  })

  test('When 任务失败 Then 红圈叉之外只追加中性单行摘要，不显示状态标签和堆栈', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={[activity('verify', 'error', 'Error: 测试未通过\n完整堆栈')]} />)
    expect(html).toContain('data-plan-status="error"')
    expect(html).toContain('data-plan-error=""')
    expect(html).toContain('测试未通过')
    expect(html).not.toMatch(/完整堆栈|text-destructive|执行失败|>失败</)
  })

  test('When 当前任务等待会话审批 Then 用琥珀色空心圆表达，不向清单加入审批字样', () => {
    const html = renderToStaticMarkup(<TaskProgressCard activities={[activity('verify', 'in_progress'), activity('next', 'pending')]} approvalPending />)
    expect(html).toContain('data-plan-status="approval"')
    expect(html).toContain('data-plan-status="pending"')
    expect(html).not.toMatch(/>等待审批<|>等待授权</)
  })

  test('When 没有已确认的任务 Then 不生成空卡片', () => {
    expect(renderToStaticMarkup(<TaskProgressCard activities={[]} />)).toBe('')
    expect(renderToStaticMarkup(<TaskProgressCard activities={[{ ...activity('unconfirmed', 'pending'), done: false }]} />)).toBe('')
  })
})
