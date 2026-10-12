import { describe, expect, test } from 'bun:test'
import {
  getGroupPreview, groupIntoTurns, isScheduledRunText,
  readSessionMessagesFromString, renderTranscriptMarkdown, stripScheduledRunMarker, toTranscript,
} from './index'

describe('Gamma 自动任务历史兼容', () => {
  for (const marker of ['<!--GAMMA_SCHEDULED_RUN-->', '<!--PROMA_SCHEDULED_RUN-->']) {
    test(`Given 带 ${marker} 的历史消息 When 显示、预览或导出 Then 识别自动任务并隐藏内部标记`, () => {
      const text = `每日检查\n${marker}`
      const raw = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null })
      const groups = groupIntoTurns(readSessionMessagesFromString(raw))

      expect(isScheduledRunText(text)).toBe(true)
      expect(stripScheduledRunMarker(text)).toBe('每日检查')
      expect(getGroupPreview(groups[0]!)).toBe('每日检查')
      const transcript = toTranscript(groups)
      expect(transcript[0]!.text).toBe('每日检查')
      expect(renderTranscriptMarkdown(transcript)).not.toContain(marker)
    })
  }

  test('Given 混合重复的旧新标记 When 清洗 Then 保留正文并删除所有完整标记', () => {
    const text = '结果 <!--PROMA_SCHEDULED_RUN--> 保留\n<!--GAMMA_SCHEDULED_RUN--><!--PROMA_SCHEDULED_RUN-->'
    expect(stripScheduledRunMarker(text)).toBe('结果  保留')
  })

  test('Given 普通消息或近似标记 When 渲染 Then 保持普通来源且不误删用户正文', () => {
    const text = '解释 GAMMA_SCHEDULED_RUN 和 <!--PROMA_SCHEDULED_RUN 的用途'
    expect(isScheduledRunText(text)).toBe(false)
    expect(stripScheduledRunMarker(text)).toBe(text)
  })
})
