import { describe, expect, test } from 'bun:test'
import { getSchema } from '@tiptap/core'
import { createMarkdownWorkspaceExtensions } from './markdown-workspace-schema'
import { prepareMarkdownDocument } from './markdown-mode-transition'

describe('Given 生产编辑器 schema', () => {
  const schema = getSchema(createMarkdownWorkspaceExtensions())
  test('When 粗体、斜体与链接包含公式 Then 原子公式继承格式且安全往返', () => {
    const source = '**低频（$\\omega < \\frac{1}{T}$）**：**$b < 1$**，*$x$* 与 [$y$](https://example.com)\n'
    const result = prepareMarkdownDocument(schema, source)
    expect(result.supported).toBe(true)
    const marks: string[][] = []
    result.document?.descendants(node => { if (node.type.name === 'math_inline') marks.push(node.marks.map(mark => mark.type.name)) })
    expect(marks).toEqual([['bold'], ['bold'], ['italic'], ['link']])
  })
  test('When 列表正文与嵌套列表之间有空行 Then 富文本保留节点与空行语义', () => {
    const source = '* **计划**\n\n  * 早晨\n'
    const result = prepareMarkdownDocument(schema, source)
    expect(result.supported).toBe(true)
    expect(result.document?.textContent).toBe('计划早晨')
    expect(result.source).toBe(source)
  })
  test('When 阅读解析 Then 不重写原文且核心语法保留', () => {
    const source = '---\ntitle: 内容\n---\n\n# 标题\n\n- [x] 项目\n\n脚注[^a] $x$ ![图](./a.png)\n\n[^a]: 注释\n\n| a | b |\n| -- | -- |\n| c | d |\n'
    const result = prepareMarkdownDocument(schema, source)
    expect(result.supported).toBe(true)
    expect(result.source).toBe(source)
    expect(result.document?.textContent).toContain('标题')
    expect(result.document?.toJSON().content).toBeDefined()
  })
  test('When HTML 带脚本 Then 作为惰性原始语法保存，不执行', () => {
    const source = '<script>alert("bad")</script>\n'
    const result = prepareMarkdownDocument(schema, source)
    expect(result.supported).toBe(true)
    expect(result.document?.firstChild?.type.name).toBe('html_block')
    expect(result.document?.firstChild?.attrs.value).toContain('<script>')
  })
  test('When 超过富文本阈值 Then 保留源码并降级', () => {
    const source = 'x'.repeat(1024 * 1024 + 1)
    const result = prepareMarkdownDocument(schema, source)
    expect(result.supported).toBe(false)
    expect(result.source).toBe(source)
  })
})
