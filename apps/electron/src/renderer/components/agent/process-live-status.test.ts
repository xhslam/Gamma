import { describe, expect, test } from 'bun:test'
import type { SDKContentBlock, SDKMessage } from '@gamma/shared'
import { formatProcessElapsed, getProcessLiveStatus } from './process-live-status'

const edit: SDKContentBlock = { type: 'tool_use', id: 'edit', name: 'Edit', input: { path: '/project/src/ProductCard.tsx' } }
const read: SDKContentBlock = { type: 'tool_use', id: 'read', name: 'Read', input: { path: '/project/package.json' } }
function result(id: string, isError = false): SDKMessage {
  return { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: '', is_error: isError }] } }
}

describe('Given 单行实时动作', () => {
  test('When 文件编辑进行中 Then 显示动作与短文件名，不显示工具名或全路径', () => {
    expect(getProcessLiveStatus([edit], [], true)).toMatchObject({ key: 'edit', label: '正在编辑 ProductCard.tsx', running: true, waiting: false })
  })
  test('When 最新并行调用结束但之前调用仍运行 Then 选择真正尚未结束的调用', () => {
    expect(getProcessLiveStatus([edit, read], [result('read')], true)).toMatchObject({ key: 'edit', running: true })
  })
  test('When 同会话调用等待审批 Then 暂停活动动效；已存在的结果优先于迟到审批', () => {
    expect(getProcessLiveStatus([edit], [], true, new Set(['edit']))).toMatchObject({ waiting: true, running: false })
    expect(getProcessLiveStatus([edit], [result('edit')], true, new Set(['edit']))).toMatchObject({ waiting: false, label: '正在整理回复' })
  })
  test('When 有其他会话审批 Then 不影响当前调用', () => {
    expect(getProcessLiveStatus([edit], [], true, new Set(['other']))).toMatchObject({ waiting: false, running: true })
  })
  test('When 流式结束且没有结果 Then 不宣称正在执行或成功', () => {
    expect(getProcessLiveStatus([edit], [], false)).toMatchObject({ label: '编辑 ProductCard.tsx', running: false })
  })
  test('When 思考、整理输出或只有计划 Then 给出当前动作而非工具统计', () => {
    expect(getProcessLiveStatus([{ type: 'thinking', thinking: '检查' }], [], true).label).toBe('正在思考')
    expect(getProcessLiveStatus([], [], true, new Set(), '正在验证样式').label).toBe('正在验证样式')
    expect(getProcessLiveStatus([edit], [result('edit', true)], true).label).toBe('正在整理回复')
  })
  test('When 展示命令 Then 有动作而没有 Bash 前缀', () => {
    expect(getProcessLiveStatus([{ type: 'tool_use', id: 'cmd', name: 'Bash', input: { command: 'bun test' } }], [], true).label).toBe('正在执行 bun test')
  })
})

describe('Given 已用时间', () => {
  test('When 格式化秒、分钟和异常输入 Then 保持单行整数时间且不显示负数', () => {
    expect([0, 18_900, 60_000, 125_000, -1, Number.NaN].map(formatProcessElapsed)).toEqual(['0s', '18s', '1m 0s', '2m 5s', '0s', '0s'])
  })
})
