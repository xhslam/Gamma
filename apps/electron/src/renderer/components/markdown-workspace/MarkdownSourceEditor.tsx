import * as React from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, indentUnit } from '@codemirror/language'
import { normalizeMarkdownEditorPreferences } from '@gamma/shared'
import type { MarkdownEditorPreferences } from '@gamma/shared'
import { guardCodeMirrorKeyBinding, isImeKeyEvent, markCodeMirrorCompositionEnd } from './vmark/utils/imeGuard'

// 保留原有语法结构/字重，只将默认高亮的独立色板换成暖色文字。
const sourceHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => ({
  ...spec,
  color: spec.color ? 'hsl(var(--foreground))' : undefined,
  backgroundColor: spec.backgroundColor ? 'hsl(var(--muted))' : undefined,
})))

export interface MarkdownSourceEditorHandle { view: () => EditorView | null; scrollTo: (offset: number) => void }
interface Props {
  value: string; readOnly: boolean; onChange: (source: string) => void; onSave?: () => void
  initialScrollTop?: number; onScroll?: (top: number) => void
  autoFocus?: boolean
  preferences?: MarkdownEditorPreferences
}
function sourcePreferences(preferences: MarkdownEditorPreferences) {
  const monoFont = preferences.monoFont === 'menlo' ? 'Menlo, monospace'
    : preferences.monoFont === 'monaco' ? 'Monaco, monospace' : 'var(--font-mono, monospace)'
  return [
    preferences.sourceLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    preferences.sourceWordWrap ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(preferences.tabSize), indentUnit.of(' '.repeat(preferences.tabSize)),
    EditorView.theme({ '.cm-scroller': { fontFamily: `var(--md-editor-mono, ${monoFont})`, fontSize: `var(--md-editor-size, ${preferences.fontSize}px)`, lineHeight: `var(--md-editor-line-height, ${preferences.lineHeight})` } }),
  ]
}
export const MarkdownSourceEditor = React.forwardRef<MarkdownSourceEditorHandle, Props>(function MarkdownSourceEditor(props, ref) {
  const root = React.useRef<HTMLDivElement>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const callbacks = React.useRef(props); callbacks.current = props
  const editability = React.useRef(new Compartment())
  const appearance = React.useRef(new Compartment())
  React.useImperativeHandle(ref, () => ({ view: () => viewRef.current, scrollTo: offset => {
    const view = viewRef.current; if (!view) return
    const pos = Math.max(0, Math.min(offset, view.state.doc.length))
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  } }), [])
  React.useEffect(() => {
    if (!root.current) return
    const view = new EditorView({ parent: root.current, state: EditorState.create({ doc: callbacks.current.value, extensions: [
      markdown(), syntaxHighlighting(sourceHighlightStyle), history(),
      appearance.current.of(sourcePreferences(normalizeMarkdownEditorPreferences(callbacks.current.preferences))),
      editability.current.of([EditorState.readOnly.of(callbacks.current.readOnly), EditorView.editable.of(!callbacks.current.readOnly)]),
      keymap.of([guardCodeMirrorKeyBinding({ key: 'Mod-s', run: () => { callbacks.current.onSave?.(); return true } }), guardCodeMirrorKeyBinding(indentWithTab), ...defaultKeymap, ...historyKeymap]),
      EditorView.domEventHandlers({ compositionend: (_event, view) => { markCodeMirrorCompositionEnd(view) }, scroll: (_event, view) => { callbacks.current.onScroll?.(view.scrollDOM.scrollTop) } }),
      EditorView.updateListener.of(update => { if (update.docChanged && update.state.doc.toString() !== callbacks.current.value) callbacks.current.onChange(update.state.doc.toString()) }),
      EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent', color: 'hsl(var(--foreground))' }, '.cm-scroller': { overflow: 'auto' }, '.cm-content': { padding: '24px 16px' }, '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--muted))' }, '.cm-gutters': { background: 'transparent', color: 'hsl(var(--muted-foreground))', border: 'none' }, '&.cm-focused': { outline: 'none' }, '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' }, '.cm-selectionBackground': { background: 'hsl(var(--accent)) !important' } }),
    ] }) })
    viewRef.current = view; view.scrollDOM.scrollTop = callbacks.current.initialScrollTop ?? 0
    if (callbacks.current.autoFocus) view.focus()
    return () => { viewRef.current = null; view.destroy() }
  }, [])
  React.useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== props.value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
  }, [props.value])
  React.useEffect(() => { viewRef.current?.dispatch({ effects: editability.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) }) }, [props.readOnly])
  React.useEffect(() => { viewRef.current?.dispatch({ effects: appearance.current.reconfigure(sourcePreferences(normalizeMarkdownEditorPreferences(props.preferences))) }) }, [props.preferences])
  return <div ref={root} className="markdown-source-editor h-full min-h-0 flex-1 overflow-hidden" data-testid="markdown-source-editor" aria-label={props.readOnly ? 'Markdown 源码（只读）' : 'Markdown 源码编辑器'} onKeyDownCapture={event => {
    // 浏览器可能先发带 IME 标记的按键，再发 compositionstart；保留输入法默认行为。
    if (isImeKeyEvent(event.nativeEvent)) event.stopPropagation()
  }} />
})
