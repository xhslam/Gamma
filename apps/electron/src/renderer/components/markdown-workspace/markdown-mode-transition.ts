import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { parseMarkdown, serializeMarkdown } from './vmark/utils/markdownPipeline/adapter'
import { parseMarkdownToMdast } from './vmark/utils/markdownPipeline/parser'

export interface PreparedMarkdownDocument {
  source: string
  supported: boolean
  document?: PMNode
  reason?: string
}
function semanticNode(node: PMNode): unknown {
  const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !['sourceLine', 'blankLinesBefore', 'id'].includes(key)))
  const children: unknown[] = []; node.forEach(child => children.push(semanticNode(child)))
  return { type: node.type.name, attrs, text: node.text, marks: node.marks.map(mark => ({ type: mark.type.name, attrs: mark.attrs })), children }
}
function semanticAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticAst)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, item]) => !['position', 'data'].includes(key) && item !== null && item !== undefined).map(([key, item]) => [key, semanticAst(item)]))
  return value
}
/** 模式切换只生成视图；source 始终是原文。真实编辑事务才会更新待保存源码。 */
export function prepareMarkdownDocument(schema: Schema, source: string): PreparedMarkdownDocument {
  if (new TextEncoder().encode(source).length > 1024 * 1024) return { source, supported: false, reason: '文档超过 1 MiB，仅提供源码模式，避免富文本解析阻塞。' }
  try {
    const document = parseMarkdown(schema, source, { preserveBlankLines: true })
    const serialized = serializeMarkdown(schema, document, { preserveBlankLines: true })
    const reparsed = parseMarkdown(schema, serialized, { preserveBlankLines: true })
    const originalAst = semanticAst(parseMarkdownToMdast(source, { preserveBlankLines: true }))
    const serializedAst = semanticAst(parseMarkdownToMdast(serialized, { preserveBlankLines: true }))
    // 也核验第一次 AST → PM 是否丢节点，而不是只比较已降级后的 PM。
    if (JSON.stringify(originalAst) !== JSON.stringify(serializedAst) || JSON.stringify(semanticNode(document)) !== JSON.stringify(semanticNode(reparsed))) return { source, supported: false, reason: '此文档包含无法安全往返的富文本结构。原文已保留，请使用源码模式。' }
    return { source, supported: true, document }
  } catch {
    return { source, supported: false, reason: '此文档暂不能安全转换为富文本。原文已保留，请使用源码模式。' }
  }
}
