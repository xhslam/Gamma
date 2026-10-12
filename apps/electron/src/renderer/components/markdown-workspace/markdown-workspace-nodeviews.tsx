import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { NodeViewRenderer } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { highlightCode } from '@gamma/core'
import { MermaidBlock } from '@gamma/ui'
import { MATH_BLOCK_LANGUAGE } from './vmark/utils/markdownPipeline/mdastBlockConverters'
import { createNotesMathInlineNodeView, createNotesMathBlockNodeView } from './auris/notes-math-node-view'

export function createWorkspaceImageView(resolveMedia: (src: string) => Promise<string | null>): NodeViewRenderer {
  return ({ node }) => {
    const dom = document.createElement(node.isInline ? 'span' : 'figure')
    const image = document.createElement('img'); image.alt = String(node.attrs.alt ?? '图片'); image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'
    const placeholder = document.createElement('span'); placeholder.textContent = image.alt || '图片不可用'
    dom.append(placeholder); let destroyed = false
    const src = String(node.attrs.src ?? '')
    const resolution = /^https:\/\//i.test(src) ? Promise.resolve(src) : resolveMedia(src)
    void resolution.then(url => { if (destroyed || !url) return; image.src = url; dom.replaceChildren(image); image.addEventListener('error', () => { if (!destroyed) dom.replaceChildren(placeholder) }) }).catch(() => { /* 保留安全占位 */ })
    return { dom, ignoreMutation: () => true, destroy: () => { destroyed = true; image.removeAttribute('src') } }
  }
}
export const workspaceMathView: NodeViewRenderer = ({ node, view, getPos }) => createNotesMathInlineNodeView(node, view, getPos)
export function createWorkspaceCodeView(theme: 'github-dark' | 'github-light' | (() => 'github-dark' | 'github-light')): NodeViewRenderer {
  return ({ node, view, getPos }) => {
    const language = String(node.attrs.language ?? 'text')
    if (language === MATH_BLOCK_LANGUAGE || ['math', 'latex', 'katex'].includes(language.toLowerCase())) {
      return createNotesMathBlockNodeView(node, view, getPos)
    }
    const dom = document.createElement('div'); dom.className = 'markdown-code-block'
    const code = document.createElement('code'); const pre = document.createElement('pre'); pre.append(code)
    if (view.editable) { dom.append(pre); return { dom, contentDOM: code } }
    const source = node.textContent
    let destroyed = false
    if (language.toLowerCase() === 'mermaid') {
      const root = createRoot(dom); root.render(<MermaidBlock code={source} />)
      return { dom, ignoreMutation: () => true, destroy: () => { queueMicrotask(() => root.unmount()) } }
    }
    code.textContent = source; dom.append(pre)
    void highlightCode({ code: source, language, theme: typeof theme === 'function' ? theme() : theme }).then(result => { if (!destroyed) dom.innerHTML = DOMPurify.sanitize(result.html) }).catch(() => { /* 保留未高亮代码 */ })
    return { dom, ignoreMutation: () => true, destroy: () => { destroyed = true } }
  }
}
