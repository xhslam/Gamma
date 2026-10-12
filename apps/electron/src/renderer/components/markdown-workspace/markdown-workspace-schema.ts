import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import type { Extensions, NodeViewRenderer } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'

export interface MarkdownWorkspaceSchemaHost {
  imageView?: NodeViewRenderer
  mathView?: NodeViewRenderer
  codeView?: NodeViewRenderer
}
interface AtomSpec { name: string; inline?: boolean; defaults: Record<string, unknown>; label: string }
function inertAtom(spec: AtomSpec): Node {
  return Node.create({
    name: spec.name, group: spec.inline ? 'inline' : 'block', inline: spec.inline ?? false, atom: true,
    addAttributes: () => Object.fromEntries(Object.entries(spec.defaults).map(([key, value]) => [key, { default: value, rendered: false }])),
    parseHTML: () => [{ tag: `[data-vmark-node="${spec.name}"]` }],
    // 原始 HTML/frontmatter 保留为文字，不能插入 innerHTML 或执行脚本。
    renderHTML: ({ node }) => [spec.inline ? 'span' : 'pre', { 'data-vmark-node': spec.name, class: 'markdown-artifact' }, `${spec.label}${String(node.attrs.value ?? node.attrs.content ?? node.attrs.label ?? node.attrs.url ?? '')}`],
  })
}
const blocks = ['paragraph', 'heading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'block_image', 'frontmatter', 'html_block', 'alertBlock', 'detailsBlock', 'footnote_definition', 'link_definition', 'tableOfContents']

/** 独立生产 schema：使用既有 Tiptap primitives，声明 VMark pipeline 的语义属性。
 * 不依赖上游测试 schema，不把未知节点悄悄变成普通段落。
 */
export function createMarkdownWorkspaceExtensions(host: MarkdownWorkspaceSchemaHost = {}): Extensions {
  const originAttributes = Extension.create({
    name: 'vmarkDocumentAttributes',
    addGlobalAttributes: () => [
      { types: blocks, attributes: { sourceLine: { default: null, rendered: false }, blankLinesBefore: { default: null, rendered: false } } },
      { types: ['heading'], attributes: { id: { default: null } } },
      { types: ['codeBlock'], attributes: { meta: { default: null, rendered: false } } },
      { types: ['bulletList', 'orderedList'], attributes: { spread: { default: false, rendered: false } } },
      { types: ['listItem'], attributes: { spread: { default: false, rendered: false }, tightBefore: { default: false, rendered: false } } },
      { types: ['tableCell', 'tableHeader'], attributes: { alignment: { default: null, renderHTML: attrs => ['left', 'center', 'right'].includes(String(attrs.alignment)) ? { style: `text-align: ${String(attrs.alignment)}` } : {} } } },
    ],
  })
  const listItem = Node.create({
    name: 'listItem', content: 'paragraph block*', defining: true,
    addAttributes: () => ({ checked: { default: null, rendered: false } }),
    parseHTML: () => [{ tag: 'li' }],
    renderHTML: ({ node, HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes, { 'data-checked': node.attrs.checked === null ? undefined : String(node.attrs.checked) }), 0],
    addKeyboardShortcuts() { return { Enter: () => this.editor.commands.splitListItem('listItem'), Tab: () => this.editor.commands.sinkListItem('listItem'), 'Shift-Tab': () => this.editor.commands.liftListItem('listItem') } },
    addNodeView: () => ({ node, view, getPos }) => {
      const dom = document.createElement('li'); const contentDOM = document.createElement('div'); dom.append(contentDOM)
      if (node.attrs.checked !== null) {
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.attrs.checked === true; checkbox.disabled = !view.editable; checkbox.contentEditable = 'false'; dom.prepend(checkbox)
        checkbox.addEventListener('change', () => { const pos = getPos(); if (view.editable && typeof pos === 'number') view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked })) })
        dom.classList.add('markdown-task-item')
      }
      return { dom, contentDOM }
    },
  })
  const image = (name: string, inline: boolean) => Node.create({
    name, group: inline ? 'inline' : 'block', inline, atom: true,
    addAttributes: () => ({ src: { default: '', rendered: false }, alt: { default: '', rendered: false }, title: { default: '', rendered: false }, referenceId: { default: null, rendered: false }, referenceType: { default: null, rendered: false } }),
    parseHTML: () => [{ tag: inline ? 'img' : 'figure' }],
    // 无 host 时也不把任意本地路径或不安全 URL 放入 DOM。
    renderHTML: ({ node }) => [inline ? 'span' : 'figure', { 'data-vmark-node': name }, String(node.attrs.alt || '图片')],
    ...(host.imageView ? { addNodeView: () => host.imageView! } : {}),
  })
  const container = (name: string, tag: string, content: string, defaults: Record<string, unknown> = {}) => Node.create({
    name, group: name === 'detailsSummary' ? undefined : 'block', content,
    addAttributes: () => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { default: value, rendered: false }])),
    parseHTML: () => [{ tag }], renderHTML: () => [tag, { 'data-vmark-node': name }, 0],
  })
  // Tiptap 的 extension NodeViews 会覆盖 editorProps.nodeViews，代码宿主必须在 extension 层注册。
  const starterKit = host.codeView ? StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(extension => extension instanceof Node && extension.name === 'codeBlock'
        ? extension.extend({ addNodeView: () => host.codeView! }) : extension)
    },
  }) : StarterKit
  return [
    starterKit.configure({ link: false, underline: false, listItem: false }),
    originAttributes, listItem,
    Link.extend({ addAttributes() { return { ...this.parent?.(), referenceId: { default: null, rendered: false }, referenceType: { default: null, rendered: false } } } }).configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    Underline,
    Mark.create({ name: 'subscript', parseHTML: () => [{ tag: 'sub' }], renderHTML: () => ['sub', 0] }),
    Mark.create({ name: 'superscript', parseHTML: () => [{ tag: 'sup' }], renderHTML: () => ['sup', 0] }),
    Mark.create({ name: 'highlight', parseHTML: () => [{ tag: 'mark' }], renderHTML: () => ['mark', 0] }),
    Table.configure({ resizable: false }), TableRow, TableCell, TableHeader,
    image('image', true), image('block_image', false),
    inertAtom({ name: 'math_inline', inline: true, defaults: { content: '' }, label: '' }).extend(host.mathView ? { addNodeView: () => host.mathView! } : {}),
    inertAtom({ name: 'footnote_reference', inline: true, defaults: { label: '1' }, label: '注 ' }),
    container('footnote_definition', 'aside', 'paragraph+', { label: '1' }),
    container('alertBlock', 'aside', 'block+', { alertType: 'NOTE' }),
    container('detailsBlock', 'details', 'detailsSummary block+', { open: false }),
    container('detailsSummary', 'summary', 'inline*'),
    Node.create({ name: 'wikiLink', inline: true, group: 'inline', content: 'text*', addAttributes: () => ({ value: { default: '' } }), parseHTML: () => [{ tag: '[data-vmark-node="wikiLink"]' }], renderHTML: () => ['span', { 'data-vmark-node': 'wikiLink' }, 0] }),
    inertAtom({ name: 'link_definition', defaults: { identifier: '', label: null, url: '', title: null }, label: '链接定义：' }),
    inertAtom({ name: 'frontmatter', defaults: { value: '' }, label: '---\n' }),
    inertAtom({ name: 'html_inline', inline: true, defaults: { value: '' }, label: '' }),
    inertAtom({ name: 'html_block', defaults: { value: '' }, label: '' }),
    inertAtom({ name: 'tableOfContents', defaults: {}, label: '目录 [TOC]' }),
  ]
}
