// 移植自 xiaolai/vmark @ ca71e3e0；ISC 许可见本移植目录根 LICENSE。
// 将 sourcePeekActions 的 Tauri 窗口、全局 stores 与统一历史替换为显式文档身份。
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { applySourcePeekMarkdown, getExpandedSourcePeekRange, serializeSourcePeekRange } from './sourcePeek'
import type { SourcePeekRange } from './sourcePeek'

const SOURCE_PEEK_EXCLUDED_TYPES = new Set(['codeBlock', 'code_block', 'block_image', 'frontmatter', 'html_block', 'horizontalRule'])
export function canUseSourcePeek(typeName: string): boolean { return !SOURCE_PEEK_EXCLUDED_TYPES.has(typeName) }
export interface MarkdownSourcePeek {
  documentId: string
  range: SourcePeekRange
  originalDocument: PMNode
  markdown: string
  blockType: string
}
export function openMarkdownSourcePeek(view: EditorView, documentId: string): MarkdownSourcePeek | null {
  const range = getExpandedSourcePeekRange(view.state)
  const node = view.state.doc.nodeAt(range.from)
  if (!node || !canUseSourcePeek(node.type.name)) return null
  return { documentId, range, originalDocument: view.state.doc, markdown: serializeSourcePeekRange(view.state, range, { preserveBlankLines: true }), blockType: node.type.name }
}
/** 文档切换或内容变化后拒绝旧 range；取消仅关闭宿主 UI，从未派发替换事务。 */
export function commitMarkdownSourcePeek(view: EditorView, documentId: string, peek: MarkdownSourcePeek, markdown: string): boolean {
  if (peek.documentId !== documentId || !view.editable || !view.state.doc.eq(peek.originalDocument)) return false
  return applySourcePeekMarkdown(view, peek.range, markdown, { preserveBlankLines: true })
}
