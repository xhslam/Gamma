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
