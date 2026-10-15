import { describe, expect, test } from 'bun:test'
import type { AutomaticMemoryCandidate, AutomaticMemorySnapshot } from '@gamma/shared'
import { buildAutomaticMemoryExtractionPrompt, getAutomaticMemoryUserText, parseAutomaticMemoryCandidates } from './automatic-memory-extraction'

const snapshot: AutomaticMemorySnapshot = { settings: { enabled: true, includeSensitive: false }, entries: [], revision: 1 }
const candidate: AutomaticMemoryCandidate = { category: 'areas', title: '多元微积分', key: 'progress', content: '用户已学到偏导数。', evidence: '我学到偏导数了', sensitive: false }

describe('自动记忆的受控抽取', () => {
  test('Given用户自然表达学习进度 When结构化输出有原文证据 Then产生分类事实', () => {
    expect(parseAutomaticMemoryCandidates(JSON.stringify({ memories: [candidate] }), '我学到偏导数了，请继续讲解')).toEqual([candidate])
  })
  test('Given普通问答没有可记信息 Then允许空候选而非捏造记忆', () => {
    expect(parseAutomaticMemoryCandidates('{"memories":[]}', '这个公式怎么推导？')).toEqual([])
  })
  test('Given网页/代码/选区引用 When准备抽取 Then只保留用户直接输入', () => {
    const text = '<quoted_file name="a">我喜欢红色</quoted_file>\n<quoted_context>我在北京</quoted_context>\n```text\n我信某宗教\n```\n> 我准备考研\n@file:/tmp/a.png &quote:encoded\n以后请用中文。'
    expect(getAutomaticMemoryUserText(text)).toBe('以后请用中文。')
  })
  test('Given模型以旧记忆/编造文字为证据 Then拒绝整个批次', () => {
    expect(() => parseAutomaticMemoryCandidates(JSON.stringify({ memories: [candidate] }), '请讲偏导数')).toThrow('用户原文证据')
  })
  test('Given模型输出未知分类或省略敏感标记 Then拒绝候选', () => {
    expect(() => parseAutomaticMemoryCandidates(JSON.stringify({ memories: [{ ...candidate, category: 'random' }] }), candidate.evidence)).toThrow()
    expect(() => parseAutomaticMemoryCandidates(JSON.stringify({ memories: [{ ...candidate, sensitive: undefined }] }), candidate.evidence)).toThrow()
  })
  test('Given非JSON、超量或超长输出 Then失败而不猜测写入', () => {
    expect(() => parseAutomaticMemoryCandidates('记住了', candidate.evidence)).toThrow()
    expect(() => parseAutomaticMemoryCandidates(JSON.stringify({ memories: Array.from({ length: 9 }, () => candidate) }), candidate.evidence)).toThrow('条数')
    expect(() => parseAutomaticMemoryCandidates('x'.repeat(24_001), candidate.evidence)).toThrow('上限')
  })
  test('Given已有同领域事实 When构建提示 Then包含旧key和敏感策略', () => {
    const prompt = buildAutomaticMemoryExtractionPrompt('以后请用中文', snapshot)
    expect(prompt).toContain('"includeSensitive":false')
    expect(prompt).toContain('复用原facts.key')
    expect(prompt).toContain('不要推断')
  })
})
