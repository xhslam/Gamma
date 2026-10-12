import { describe, expect, test } from 'bun:test'
import { parseMarkdown, serializeMarkdown } from './utils/markdownPipeline/adapter'
import { testSchema } from './utils/markdownPipeline/testSchema'
import { formatMarkdownChecked } from './lib/cjkFormatter/formatter'
import { DEFAULT_CJK_FORMATTING } from './lib/cjkFormatter/types'
import { isImeKeyEvent, guardCodeMirrorKeyBinding } from './utils/imeGuard'

const fixtures = [
  '# 标题\n\n正文 **粗体** 和 `code`。\n',
  '- [x] 完成\n- [ ] 未完成\n\n> 引用\n',
  '| 名称 | 值 |\n| :--- | ---: |\n| 你好 | 123 |\n',
  '---\ntitle: 你好\n---\n\n# 文档\n\n脚注[^1]\n\n[^1]: 注释\n',
  '[链接][id]\n\n[id]: https://example.com "标题"\n\n![图片](./image.png)\n',
  '行内 $a+b$\n\n$$\nx^2\n$$\n\n```mermaid\ngraph TD\nA-->B\n```\n',
  '<div onclick="alert(1)">保留原 HTML，不执行</div>\n',
]

describe('Given VMark Markdown 转换核心', () => {
  for (const [index, source] of fixtures.entries()) {
    test(`When 用例 ${index + 1} 往返转换 Then 文档节点不丢失`, () => {
      const document = parseMarkdown(testSchema, source)
      const result = serializeMarkdown(testSchema, document)
      const reparsed = parseMarkdown(testSchema, result)
      expect(reparsed.textContent).toBe(document.textContent)
      expect(result.trim().length).toBeGreaterThan(0)
      if (source.includes('title: 你好')) expect(result).toContain('title: 你好')
      if (source.includes('[^1]')) expect(result).toContain('[^1]')
      if (source.includes('[id]:')) expect(result).toContain('[id]:')
      if (source.includes('mermaid')) expect(result).toContain('mermaid')
      if (source.includes('onclick')) expect(result).toContain('onclick')
    })
  }
})

describe('Given 中文排版与 IME 保护', () => {
  test('When 排版 Then 代码、URL 和 frontmatter 保持原样', () => {
    const input = '---\ntitle: 中文ABC\n---\n\n中文ABC\n\n`中文ABC`\n\n```ts\n中文ABC\n```\n\n[链接](https://example.com/中文ABC)\n'
    const result = formatMarkdownChecked(input, DEFAULT_CJK_FORMATTING)
    expect(result.refused).toBe(false)
    expect(result.text).toContain('中文 ABC')
    expect(result.text).toContain('title: 中文ABC')
    expect(result.text).toContain('`中文ABC`')
    expect(result.text).toContain('```ts\n中文ABC\n```')
    expect(result.text).toContain('https://example.com/中文ABC')
  })
  test('When IME 确认按键 Then 不执行编辑命令', () => {
    expect(isImeKeyEvent({ isComposing: true })).toBe(true)
    expect(isImeKeyEvent({ keyCode: 229 })).toBe(true)
    expect(isImeKeyEvent({ isComposing: false })).toBe(false)
    const binding = guardCodeMirrorKeyBinding({ key: 'Mod-s' })
    expect('run' in binding).toBe(false)
  })
})
