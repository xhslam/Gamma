import { describe, expect, test } from 'bun:test'
import type { AgyActivityEvent } from '@gamma/shared'
import { agyEventStateLabel, formatAgyDuration, groupAgyActivity } from './agy-activity-presentation'

const event = (sequence: number, value: Partial<AgyActivityEvent>): AgyActivityEvent => ({ sequence, timestamp: sequence, kind: 'text', ...value })

describe('Given agy 连续输出的展示模型', () => {
  test('When 同一步骤分多行上报 Then 合并正文、保留空行和最新状态且不修改原始记录', () => {
    const events = [event(1, { text: '## 标题\n', stepIndex: 2, state: 'ACTIVE' }), event(2, { text: '\n', stepIndex: 2 }), event(3, { text: '**结果**', stepIndex: 2, state: 'DONE' })]
    const before = structuredClone(events)
    expect(groupAgyActivity(events)).toEqual([event(1, { text: '## 标题\n\n**结果**', stepIndex: 2, state: 'DONE' })])
    expect(events).toEqual(before)
  })
  test('When 跨工具、步骤或携带详情 Then 保持事件边界和原始顺序', () => {
    const events = [event(1, { text: '一', stepIndex: 1 }), event(2, { kind: 'tool', toolName: 'read_file', details: { path: '/example' } }), event(3, { text: '二', stepIndex: 1 }), event(4, { text: '三', stepIndex: 2 }), event(5, { text: '四', stepIndex: 2, details: { raw: true } }), event(6, { text: '五', stepIndex: 2 })]
    expect(groupAgyActivity(events)).toEqual(events)
  })
  test('When 只有空白文本 Then 不生成空卡片；空白携带详情时仍保留', () => {
    const detail = event(2, { text: '', details: { raw: true } })
    expect(groupAgyActivity([event(1, { text: '\n' }), detail])).toEqual([detail])
    expect(groupAgyActivity([])).toEqual([])
  })
  test('When CLI 返回耗时 Then 使用短格式并拒绝非法数值', () => {
    expect(formatAgyDuration(17.444805)).toBe('17.4s')
    expect(formatAgyDuration(128.5)).toBe('2m 8s')
    expect(formatAgyDuration(0)).toBe('0s')
    for (const value of [undefined, -1, NaN, Infinity]) expect(formatAgyDuration(value)).toBeUndefined()
  })
  test('When 翻译事件状态 Then DONE 仅表示结束，未知状态保留原文', () => {
    expect(agyEventStateLabel('DONE')).toBe('已结束')
    expect(agyEventStateLabel('ERROR')).toBe('出错')
    expect(agyEventStateLabel('custom')).toBe('custom')
  })
})
