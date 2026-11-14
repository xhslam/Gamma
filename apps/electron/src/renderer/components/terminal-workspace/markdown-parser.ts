import { unified } from 'unified'
import remarkParse from 'remark-parse'

const processor = unified().use(remarkParse)

export function parseNotesMarkdownAst(markdown: string): any {
  try {
    return processor.parse(markdown)
  } catch {
    return { type: 'root', children: [] }
  }
}
