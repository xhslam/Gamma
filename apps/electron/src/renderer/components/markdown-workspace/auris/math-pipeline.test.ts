import { describe, expect, test } from 'bun:test'
import { getSchema } from '@tiptap/core'
import { createMarkdownWorkspaceExtensions } from '../markdown-workspace-schema'
import { prepareMarkdownDocument } from '../markdown-mode-transition'
import { normalizeNotesMathDelimiters, sanitizeMathContent } from './notes-markdown-dialect'

describe('Given Auris 与 VMark 共用的生产公式管线', () => {
  const schema = getSchema(createMarkdownWorkspaceExtensions())
  for (const [label, source, count] of [
    ['美元定界符', '行内 $x^2$\n\n$$\n\\frac{1}{2}\\tag{1}\n$$', 2],
    ['单层反斜杠', String.raw`行内 \(x^2\)，公式： \[\frac{1}{2}\]`, 2],
    ['双层反斜杠', String.raw`行内 \\(\\omega\_{c0}\\)，公式： \\[\\frac{1}{2}\\]`, 2],
    ['三层反斜杠', String.raw`## 公式： \\\[\\mathbf{Z = P - 2N}\\\]`, 1],
    ['列表与引用', String.raw`- 公式： \[\frac{1}{2}\]` + '\n\n' + String.raw`> 公式： \[x^2\]`, 2],
    ['货币和代码', '价格 $100 到 $200，`$x$`\n\n```tex\n\\(x\\)\n```', 0],
    ['链接地址', '[链接](https://example.com/\\(x\\))', 0],
    ['未配对定界符', String.raw`保留 \\(x^2\)`, 0],
  ] as const) {
    test(`When 解析${label} Then 公式数正确且展示不改写原文`, () => {
      const result = prepareMarkdownDocument(schema, source)
      expect(result.supported).toBe(true)
      let mathCount = 0
      result.document?.descendants(node => {
        if (node.type.name === 'math_inline' || (node.type.name === 'codeBlock' && node.attrs.language === '$$math$$')) mathCount++
      })
      expect(mathCount).toBe(count)
      expect(result.source).toBe(source)
    })
  }
  test('When 修复渲染副本 Then 兼容实体、百分号和 centernot 源码', () => {
    expect(sanitizeMathContent(String.raw`\\omega\_{c} &lt; 15%`)).toBe(String.raw`\omega_{c} < 15\%`)
    const literal = '`\\(x\\)`\n\n```tex\n\\[x\\]\n```'
    expect(normalizeNotesMathDelimiters(literal)).toBe(literal)
  })
})
