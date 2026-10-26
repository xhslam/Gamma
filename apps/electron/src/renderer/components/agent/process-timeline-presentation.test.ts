import { describe, expect, test } from 'bun:test'
import { getProcessActionLabel, getProcessErrorSummary } from './process-timeline-presentation'

const label = (name: string, input: Record<string, unknown>) => getProcessActionLabel({ type: 'tool_use', id: 'a', name, input })

describe('Given 极简时间线动作与对象', () => {
  test('When 展示命令 Then 仅显示动作和命令，不附加工具名前缀，命令使用等宽字体', () => {
    expect(label('Bash', { command: 'bun test' })).toEqual({ action: '执行', object: 'bun test', monospace: true })
    expect(label('Bash', { command: 'bun test', description: '执行回归测试' }).action).toBe('回归测试')
    expect(label('TerminalExecute', { command: 'pwd' }).object).toBe('pwd')
  })
  test('When 文件工具携带不同格式路径 Then 保留完整路径并使用等宽字体', () => {
    for (const key of ['path', 'file_path', 'filePath']) {
      expect(label('Read', { [key]: '/repo/src/main.ts' })).toEqual({ action: '读取', object: '/repo/src/main.ts', monospace: true })
    }
    expect(label('Edit', { path: 'C:\\repo\\main.ts' }).object).toBe('C:\\repo\\main.ts')
    expect(label('Write', { path: 'notes.md' }).action).toBe('写入')
  })
  test('When 展示描述和搜索 Then 使用正文字体，不把描述混作命令', () => {
    expect(label('Agent', { description: '检查状态流' })).toEqual({ action: '委派', object: '检查状态流' })
    expect(label('WebSearch', { query: '时间线设计' })).toEqual({ action: '搜索', object: '时间线设计' })
  })
  test('When 工具为未知扩展或 MCP Then 不泄漏原始工具名前缀', () => {
    expect(label('FutureTool', { path: '/repo/main.ts' })).toEqual({ action: '处理', object: '/repo/main.ts', monospace: true })
    expect(label('mcp__demo__search', { query: '时间线' })).toEqual({ action: '处理', object: '时间线', monospace: false })
    expect(label('FutureTool', { _intent: '检查项目结构' })).toEqual({ action: '检查项目结构' })
  })
  test('When 错误有多行、ANSI 或空内容 Then 仅返回中性单行摘要，不伪造状态文字', () => {
    expect(getProcessErrorSummary('\n\u001b[31mError: 文件不存在\u001b[0m\n堆栈信息')).toBe('文件不存在')
    expect(getProcessErrorSummary('')).toBeUndefined()
    expect(getProcessErrorSummary(undefined)).toBeUndefined()
    expect(getProcessErrorSummary('x'.repeat(200))).toHaveLength(180)
  })
})
