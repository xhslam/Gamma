import * as React from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { MarkdownEditorPreferences } from '@gamma/shared'
import { markdownShortcutMatches, markdownThemeStyle } from './markdown-editor-presentation'
import { getSchema } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { createMarkdownWorkspaceExtensions } from './markdown-workspace-schema'
import { createWorkspaceCodeView, createWorkspaceImageView, workspaceMathView } from './markdown-workspace-nodeviews'
import { prepareMarkdownDocument } from './markdown-mode-transition'
import { serializeMarkdown } from './vmark/utils/markdownPipeline/adapter'
import { isImeKeyEvent, isProseMirrorInCompositionGrace, markProseMirrorCompositionEnd, isCodeMirrorComposing, isCodeMirrorInCompositionGrace } from './vmark/utils/imeGuard'
import { commitMarkdownSourcePeek, openMarkdownSourcePeek } from './vmark/sourcePeekInline/sourcePeekActions'
import type { MarkdownSourcePeek } from './vmark/sourcePeekInline/sourcePeekActions'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import type { MarkdownSourceEditorHandle } from './MarkdownSourceEditor'
import { MarkdownWorkspaceToolbar } from './MarkdownWorkspaceToolbar'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import './markdown-workspace.css'
import 'katex/dist/katex.min.css'
import './vmark/latex/katexFixes.css'
import './auris/math.css'
import { scheduleKatexFontPreload } from './vmark/latex/katexFontPreload'

export interface MarkdownWorkspaceEditorHandle { editor: () => Editor | null; openSourcePeek: () => void; scrollToLine: (line: number, headingIndex?: number) => void }
interface OriginalDocument { documentId: string; document: ProseMirrorNode; source: string }
interface Props {
  documentId: string; value: string; editing: boolean; onChange: (source: string) => void; onSave: () => void
  resolveMedia: (source: string) => Promise<string | null>; onError: (reason: string) => void
  theme?: 'github-dark' | 'github-light'; query?: string; findIndex?: number
  initialScrollTop?: number; onScroll?: (top: number) => void
  showToolbar?: boolean
  preferences?: MarkdownEditorPreferences
}
export const MarkdownWorkspaceEditor = React.forwardRef<MarkdownWorkspaceEditorHandle, Props>(function MarkdownWorkspaceEditor(props, ref) {
  const callbacks = React.useRef(props); callbacks.current = props
  const localSource = React.useRef(props.value)
  const originalDocument = React.useRef<OriginalDocument | null>(null)
  const scrollHost = React.useRef<HTMLDivElement>(null)
  const [peek, setPeek] = React.useState<MarkdownSourcePeek | null>(null)
  const [peekText, setPeekText] = React.useState('')
  const peekMount = React.useMemo(() => peek ? document.createElement('div') : null, [peek])
  const peekEditor = React.useRef<MarkdownSourceEditorHandle>(null)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [linkUrl, setLinkUrl] = React.useState('https://')
  const extensions = React.useMemo(() => createMarkdownWorkspaceExtensions({
    imageView: createWorkspaceImageView(src => callbacks.current.resolveMedia(src)), mathView: workspaceMathView,
    codeView: createWorkspaceCodeView(() => callbacks.current.theme ?? 'github-dark'),
  }), [])
  const prepared = React.useMemo(() => ({ ...prepareMarkdownDocument(getSchema(extensions), props.value), source: props.value }), [extensions, props.documentId])
  const [viewSupported, setViewSupported] = React.useState(prepared.supported)
  const editor = useEditor({
    extensions, content: prepared.document?.toJSON(), editable: props.editing,
    editorProps: {
      attributes: { class: 'markdown-workspace-prose', 'aria-label': props.editing ? 'Markdown 富文本编辑器' : 'Markdown 阅读器' },
      handleKeyDown: (view, event) => {
        if (isImeKeyEvent(event) || view.composing || isProseMirrorInCompositionGrace(view)) return false
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { callbacks.current.onSave(); return true }
        if (markdownShortcutMatches(event, callbacks.current.preferences?.shortcuts.sourcePeek ?? 'F5')) { openPeek(); return true }
        return false
      },
      handleDOMEvents: {
        compositionend: view => { markProseMirrorCompositionEnd(view); return false },
        click: (_view, event) => {
          const anchor = event.target instanceof Element ? event.target.closest('a') : null
          if (!anchor) return false
          event.preventDefault()
          const href = anchor.getAttribute('href') ?? ''
          if (/^https?:\/\//i.test(href)) void window.electronAPI.openExternal(href)
          return true
        },
      },
    },
    onUpdate: ({ editor, transaction }) => {
      if (!transaction.docChanged || !editor.isEditable) return
      try {
        // 完全撤销回初始文档时恢复原始空白格式，避免没有内容变化却仍显示未保存。
        const original = originalDocument.current
        if (prepared.document && (!original || original.documentId !== callbacks.current.documentId || original.document.type.schema !== editor.schema)) {
          // Node.eq 要求相同 schema；预解析与 Tiptap 实例分别构造 schema。
          originalDocument.current = { documentId: callbacks.current.documentId, document: editor.schema.nodeFromJSON(prepared.document.toJSON()), source: prepared.source }
        }
        const source = originalDocument.current?.document.eq(editor.state.doc) ? originalDocument.current.source : serializeMarkdown(editor.schema, editor.state.doc, { preserveBlankLines: true })
        localSource.current = source; callbacks.current.onChange(source)
      } catch { callbacks.current.onError('富文本转换失败，原始草稿未覆盖。请使用源码模式。') }
    },
  }, [props.documentId])
  React.useEffect(() => { scheduleKatexFontPreload() }, [])
  React.useEffect(() => {
    if (!editor) return
    editor.setEditable(props.editing, false)
    // 宿主 NodeView 在构造时选择预览/编辑 DOM；刷新工厂不重建 EditorState，保留选区和撤销。
    editor.view.setProps({ nodeViews: editor.extensionManager.nodeViews })
    editor.view.dom.setAttribute('aria-label', props.editing ? 'Markdown 富文本编辑器' : 'Markdown 阅读器')
    if (!props.editing) setPeek(null)
  }, [editor, props.editing, props.theme])
  React.useImperativeHandle(ref, () => ({ editor: () => editor, openSourcePeek: () => openPeek(), scrollToLine: (line, headingIndex) => {
    if (!editor) return
    let target: number | null = null
    let index = 0
    // 富文本编辑后 sourceLine 属于旧快照，使用当前目录的标题顺序定位。
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return
      if (headingIndex === undefined ? node.attrs.sourceLine === line : index === headingIndex) target = pos
      index++
    })
    if (target !== null) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target))).scrollIntoView())
  } }), [editor])
  React.useEffect(() => {
    if (!prepared.supported) callbacks.current.onError(prepared.reason ?? '无法转换文档。')
    if (scrollHost.current) scrollHost.current.scrollTop = callbacks.current.initialScrollTop ?? 0
  }, [prepared])
  React.useEffect(() => {
    if (!editor || localSource.current === props.value) return
    const next = prepareMarkdownDocument(editor.schema, props.value)
    if (!next.supported || !next.document) { setViewSupported(false); callbacks.current.onError(next.reason ?? '无法安全转换。'); return }
    // 重新读取磁盘或从源码返回时，新的原文成为精确撤销的底稿。
    originalDocument.current = { documentId: props.documentId, document: next.document, source: props.value }
    localSource.current = props.value; editor.commands.setContent(next.document.toJSON(), { emitUpdate: false })
    setViewSupported(true)
  }, [editor, props.value])
  React.useEffect(() => {
    if (!editor) return
    const query = (props.query ?? '').toLocaleLowerCase()
    const ranges: { from: number; to: number }[] = []
    editor.state.doc.descendants((node, pos) => {
      if (!query || !node.isText || !node.text) return
      const text = node.text.toLocaleLowerCase(); let offset = text.indexOf(query)
      while (offset >= 0) { ranges.push({ from: pos + offset, to: pos + offset + query.length }); offset = text.indexOf(query, offset + Math.max(query.length, 1)) }
    })
    const items = ranges.map((range, index) => Decoration.inline(range.from, range.to, { class: index === (props.findIndex ?? 0) ? 'markdown-find-active' : 'markdown-find-match' }))
    // 将段落源码放在原节点的位置，保留正文上下文与原生撤销事务。
    if (peek && peekMount && editor.state.doc.eq(peek.originalDocument)) {
      peekMount.contentEditable = 'false'
      items.push(Decoration.widget(peek.range.from, peekMount, { side: -1, stopEvent: () => true }))
      items.push(Decoration.node(peek.range.from, peek.range.to, { class: 'markdown-peek-original' }))
    }
    const decorations = DecorationSet.create(editor.state.doc, items)
    editor.view.setProps({ decorations: () => decorations })
  }, [editor, props.query, props.findIndex, props.value, peek, peekMount])
  // 编辑只更新高亮；只有用户改变查询或匹配序号时导航，避免每次输入跳回首个匹配。
  React.useEffect(() => {
    if (!editor || !props.query) return
    const query = props.query.toLocaleLowerCase()
    const ranges: { from: number; to: number }[] = []
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const text = node.text.toLocaleLowerCase(); let offset = text.indexOf(query)
      while (offset >= 0) { ranges.push({ from: pos + offset, to: pos + offset + query.length }); offset = text.indexOf(query, offset + query.length) }
    })
    const active = ranges[(props.findIndex ?? 0) % Math.max(ranges.length, 1)]
    if (active) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, active.from, active.to)).scrollIntoView())
  }, [editor, props.query, props.findIndex])
  const openPeek = () => {
    if (!editor || editor.view.composing || isProseMirrorInCompositionGrace(editor.view)) return
    const state = openMarkdownSourcePeek(editor.view, props.documentId)
    if (!state) { props.onError('此节点请使用源码模式编辑。'); return }
    setPeek(state); setPeekText(state.markdown)
  }
  const closePeek = () => { setPeek(null); editor?.view.focus() }
  const applyPeek = () => {
    if (isCodeMirrorComposing(peekEditor.current?.view()) || isCodeMirrorInCompositionGrace(peekEditor.current?.view())) return
    if (editor && peek && commitMarkdownSourcePeek(editor.view, props.documentId, peek, peekText)) closePeek()
    else props.onError('段落或文档已变化，请重新打开段落源码。')
  }
  return <div className="markdown-workspace-editor flex h-full min-h-0 flex-col" data-testid="markdown-rich-editor">
    <div ref={scrollHost} className="markdown-workspace-scroll min-h-0 flex-1 overflow-auto" onScroll={event => props.onScroll?.(event.currentTarget.scrollTop)}>
      {viewSupported ? <EditorContent editor={editor} /> : <MarkdownSourceEditor value={props.value} readOnly={!props.editing} preferences={props.preferences} onChange={props.onChange} onSave={props.onSave} />}
    </div>
    {viewSupported && editor && props.editing && (props.showToolbar ?? true) && <MarkdownWorkspaceToolbar editor={editor} shortcutLabel={props.preferences?.shortcuts.sourcePeek ?? 'F5'} themeStyle={markdownThemeStyle(props.preferences?.theme ?? 'inherit')} onSourcePeek={openPeek} onLink={() => { setLinkUrl(String(editor.getAttributes('link').href || 'https://')); setLinkOpen(true) }} />}
    {peek && peekMount && createPortal(<section className="markdown-source-peek" role="region" aria-label="段落源码" onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || isCodeMirrorComposing(peekEditor.current?.view()) || isCodeMirrorInCompositionGrace(peekEditor.current?.view())) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePeek() }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyPeek() }
    }}><header><span>段落源码</span><span className="text-muted-foreground">Esc 取消 · ⌘↵ 应用</span></header>
      <div className="markdown-source-peek-content"><MarkdownSourceEditor ref={peekEditor} value={peekText} readOnly={!props.editing} onChange={setPeekText} preferences={props.preferences} autoFocus /></div>
      <footer><Button variant="ghost" size="sm" onClick={closePeek}>取消</Button><Button variant="secondary" size="sm" disabled={!props.editing} onClick={applyPeek}>应用段落</Button></footer>
    </section>, peekMount)}
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent style={markdownThemeStyle(props.preferences?.theme ?? 'inherit')}><DialogHeader><DialogTitle>插入链接</DialogTitle></DialogHeader><input className="rounded border bg-background p-2 text-sm" aria-label="链接地址" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} /><DialogFooter><Button onClick={() => { if (/^https?:\/\//i.test(linkUrl)) { editor?.chain().focus().setLink({ href: linkUrl }).run(); setLinkOpen(false) } }}>应用链接</Button></DialogFooter></DialogContent></Dialog>
  </div>
})
