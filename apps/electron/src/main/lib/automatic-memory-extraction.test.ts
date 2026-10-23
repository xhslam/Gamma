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

  describe('Global Memory Provenance Guard (Item 7)', () => {
    test('Given 包含会话引用、工具输出与助手推论的复合输入 When 清洗 Then 彻底剥离引用与推论，只留用户直接事实', () => {
      const contaminatedText = `
<referenced_conversations>
<conversation id="ref_ext" title="Other Chat">
[user]: 在旧对话中我提到我住在美国
[assistant]: 根据分析，用户其实是全栈架构师，精通 Haskell
[tool: read_file] result: token=secret_data_12345
</conversation>
</referenced_conversations>
[tool: read_referenced_conversation] result: [消息 #0] 历史偏好
[第 0–5 条已省略，可用 read_referenced_conversation 读取（offset从0计数）]
引用「旧项目」当前不可用：源对话已删除
我本人平时主要使用 TypeScript 开发 React 应用。
`
      const cleaned = getAutomaticMemoryUserText(contaminatedText)
      expect(cleaned).toBe('我本人平时主要使用 TypeScript 开发 React 应用。')
      expect(cleaned).not.toContain('住在美国')
      expect(cleaned).not.toContain('Haskell')
      expect(cleaned).not.toContain('secret_data_12345')
      expect(cleaned).not.toContain('历史偏好')
    })

    test('Given 试图从引用资料或助手推论中提取记忆候选 When 校验证据 Then 严格拒绝', () => {
      const contaminatedUserText = '<referenced_conversations><conversation id="ref_1">用户住在美国西雅图</conversation></referenced_conversations>请帮我优化代码。'
      const cleanUserText = getAutomaticMemoryUserText(contaminatedUserText)

      // 提取用的 userText 已经被清洗为 '请帮我优化代码。'
      expect(cleanUserText).toBe('请帮我优化代码。')

      // 模型如果试图将引用里的“住在美国西雅图”作为 evidence
      const fakeCandidate: AutomaticMemoryCandidate = {
        category: 'profile',
        title: '常住地',
        key: 'location',
        content: '用户住在美国西雅图。',
        evidence: '住在美国西雅图',
        sensitive: false,
      }

      expect(() =>
        parseAutomaticMemoryCandidates(JSON.stringify({ memories: [fakeCandidate] }), cleanUserText)
      ).toThrow('用户原文证据')
    })

    test('Given 用户自身事实与引用资料并存 When 提取合法候选 Then 用户直接陈述通过校验', () => {
      const mixedText = '<referenced_conversations><conversation id="r">外部资料说用户喜欢猫</conversation></referenced_conversations>我最近正在自学Rust并发编程。'
      const cleaned = getAutomaticMemoryUserText(mixedText)
      expect(cleaned).toBe('我最近正在自学Rust并发编程。')

      const validCandidate: AutomaticMemoryCandidate = {
        category: 'areas',
        title: 'Rust语言',
        key: 'learning',
        content: '用户正在自学Rust并发编程。',
        evidence: '我最近正在自学Rust并发编程',
        sensitive: false,
      }

      const results = parseAutomaticMemoryCandidates(JSON.stringify({ memories: [validCandidate] }), cleaned)
      expect(results).toHaveLength(1)
      expect(results[0]?.key).toBe('learning')
    })
  })
})
