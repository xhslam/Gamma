import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { createMarkdownProcessor } from './vmark/utils/markdownPipeline/parser/processorFactory'
import { mdastTextContent } from './vmark/utils/markdownPipeline/mdastConverterHelpers'

export interface MarkdownStatistics { words: number; characters: number }
const wordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
/** 统计源码：字符按 Unicode code point 计数，不含空白；字词使用中文分词及 Unicode word boundaries。 */
export function markdownStatistics(source: string): MarkdownStatistics {
  let characters = 0
  let words = 0
  for (const character of source) if (!/\s/u.test(character)) characters++
  for (const segment of wordSegmenter.segment(source)) if (segment.isWordLike) words++
  return { words, characters }
}

export interface MarkdownOutlineEntry { text: string; depth: number; offset: number; line: number; index: number }
export function markdownOutline(source: string): MarkdownOutlineEntry[] {
  if (source.length > 1024 * 1024) return []
  try {
    const tree = createMarkdownProcessor().parse(source) as Root
    const entries: MarkdownOutlineEntry[] = []
    visit(tree, 'heading', node => { entries.push({ text: node.children.map(mdastTextContent).join(''), depth: node.depth, offset: node.position?.start.offset ?? 0, line: node.position?.start.line ?? 1, index: entries.length }) })
    return entries
  } catch { return [] }
}
export interface MarkdownFindMatch { from: number; to: number }
export function markdownFindMatches(source: string, query: string, caseSensitive = false): MarkdownFindMatch[] {
  if (!query) return []
  // 使用正则 i 的 UTF-16 原文位置，避免 locale lower-case 改变字符串长度后定位错误。
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(escaped, caseSensitive ? 'g' : 'gi')
  const matches: MarkdownFindMatch[] = []
  for (const match of source.matchAll(matcher)) {
    if (matches.length >= 10_000) break
    matches.push({ from: match.index, to: match.index + match[0].length })
  }
  return matches
}
export function replaceMarkdownMatch(source: string, query: string, replacement: string, index: number, caseSensitive = false): string {
  const matches = markdownFindMatches(source, query, caseSensitive)
  const match = matches[((index % matches.length) + matches.length) % matches.length]
  return match ? source.slice(0, match.from) + replacement + source.slice(match.to) : source
}
