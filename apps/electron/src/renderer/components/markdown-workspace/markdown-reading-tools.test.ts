import { describe, expect, test } from 'bun:test'
import { markdownOutline, markdownFindMatches, replaceMarkdownMatch, markdownStatistics } from './markdown-reading-tools'
describe('Given Markdown 阅读工具', () => {
  test('When 生成目录 Then 忽略 frontmatter 与代码 fence 中的井号', () => {
    const outline = markdownOutline('---\ntitle: 标题\n---\n\n# 正文\n\n```md\n# 代码\n```\n\n## 第二节\n')
    expect(outline.map(item => item.text)).toEqual(['正文', '第二节'])
    expect(outline[0]?.line).toBe(5)
  })
  test('When 统计英文与 emoji Then 不把代理对误计为两个字符', () => {
    expect(markdownStatistics('Hello world\n👋')).toEqual({ words: 2, characters: 11 })
    expect(markdownStatistics('中文😀').characters).toBe(3)
  })
  test('When 空文档或仅有空白 Then 字词与字符数为零', () => {
    expect(markdownStatistics('')).toEqual({ words: 0, characters: 0 })
    expect(markdownStatistics(' \n\t')).toEqual({ words: 0, characters: 0 })
  })
  test('When 查找并只替换当前项 Then 保留其他文本和大小写策略', () => {
    const source = 'Hello hello HELLO'
    expect(markdownFindMatches(source, 'hello', false)).toHaveLength(3)
    expect(markdownFindMatches(source, 'hello', true)).toHaveLength(1)
    expect(replaceMarkdownMatch(source, 'hello', '世界', 1, false)).toBe('Hello 世界 HELLO')
    expect(markdownFindMatches(source, '', false)).toHaveLength(0)
  })
})
