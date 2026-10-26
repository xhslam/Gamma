import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Bold, Code2, FileCode2, Heading2, Italic, Link, List, ListChecks, ListOrdered, MoreHorizontal, Quote, Table2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { isProseMirrorComposing, isProseMirrorInCompositionGrace } from './vmark/utils/imeGuard'

interface Props {
  editor: Editor
  onLink: () => void
  onSourcePeek: () => void
  shortcutLabel?: string
  themeStyle?: CSSProperties
}

interface ToolbarState {
  heading: boolean
  bold: boolean
  italic: boolean
  bulletList: boolean
  orderedList: boolean
  task: boolean
  blockquote: boolean
  codeBlock: boolean
  table: boolean
  link: boolean
}

interface FormatTool {
  name: string
  icon: LucideIcon
  active: boolean
  action: () => void
}

export function MarkdownWorkspaceToolbar({ editor, onLink, onSourcePeek, shortcutLabel = 'F5', themeStyle }: Props): React.ReactElement {
  const selectedMenuAction = useRef(false)
  const state = useEditorState<ToolbarState>({
    editor,
    selector: ({ editor: currentEditor }) => ({
      heading: currentEditor.isActive('heading', { level: 2 }),
      bold: currentEditor.isActive('bold'),
      italic: currentEditor.isActive('italic'),
      bulletList: currentEditor.isActive('bulletList'),
      orderedList: currentEditor.isActive('orderedList'),
      task: currentEditor.isActive('listItem') && typeof currentEditor.getAttributes('listItem').checked === 'boolean',
      blockquote: currentEditor.isActive('blockquote'),
      codeBlock: currentEditor.isActive('codeBlock'),
      table: currentEditor.isActive('table'),
      link: currentEditor.isActive('link'),
    }),
  })
  const run = (operation: () => void) => {
    if (!isProseMirrorComposing(editor.view) && !isProseMirrorInCompositionGrace(editor.view)) operation()
  }
  const tools: FormatTool[] = [
    { name: '标题', icon: Heading2, active: state.heading, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { name: '粗体', icon: Bold, active: state.bold, action: () => editor.chain().focus().toggleBold().run() },
    { name: '斜体', icon: Italic, active: state.italic, action: () => editor.chain().focus().toggleItalic().run() },
    { name: '列表', icon: List, active: state.bulletList, action: () => editor.chain().focus().toggleBulletList().run() },
    { name: '编号', icon: ListOrdered, active: state.orderedList, action: () => editor.chain().focus().toggleOrderedList().run() },
    { name: '任务', icon: ListChecks, active: state.task, action: () => {
      if (!editor.isActive('listItem')) editor.chain().focus().toggleBulletList().run()
      editor.chain().focus().updateAttributes('listItem', { checked: false }).run()
    } },
    { name: '引用', icon: Quote, active: state.blockquote, action: () => editor.chain().focus().toggleBlockquote().run() },
    { name: '代码', icon: Code2, active: state.codeBlock, action: () => editor.chain().focus().toggleCodeBlock().run() },
    { name: '表格', icon: Table2, active: state.table, action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ]

  return (
    <div className="markdown-format-toolbar flex shrink-0 items-center justify-center gap-1 px-3 py-1" role="toolbar" aria-label="Markdown 格式工具栏" aria-orientation="horizontal">
      {tools.map(({ name, icon: Icon, active, action }, index) => (
        <Button data-icon-button="true" key={name} data-format-index={index} variant="ghost" size="sm" className="markdown-format-button h-7 w-7 shrink-0 px-0 text-muted-foreground" title={name} aria-label={name} aria-pressed={active} onMouseDown={event => event.preventDefault()} onClick={() => run(action)}>
          <Icon aria-hidden="true" />
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-icon-button="true" variant="ghost" size="sm" className="markdown-format-overflow markdown-format-button h-7 w-7 shrink-0 px-0 text-muted-foreground" title="更多格式" aria-label="更多格式">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" style={themeStyle} onCloseAutoFocus={event => {
          // 操作完成后保留编辑器焦点；按 Escape 关闭菜单仍回到触发按钮。
          if (selectedMenuAction.current) {
            event.preventDefault()
            selectedMenuAction.current = false
          }
        }}>
          {tools.slice(3).map(({ name, icon: Icon, active, action }) => {
            const onSelect = () => {
              selectedMenuAction.current = true
              run(action)
            }
            return name === '表格'
              ? <DropdownMenuItem key={name} className="gap-2 pl-8" onSelect={onSelect}><Icon aria-hidden="true" /><span>{name}</span></DropdownMenuItem>
              : <DropdownMenuCheckboxItem key={name} className="gap-2" checked={active} onSelect={onSelect}><Icon className="h-4 w-4" aria-hidden="true" /><span>{name}</span></DropdownMenuCheckboxItem>
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="markdown-format-divider mx-1 h-4 w-px shrink-0 bg-border/60" aria-hidden="true" />
      <Button data-icon-button="true" variant="ghost" size="sm" className="markdown-format-button h-7 w-7 shrink-0 px-0 text-muted-foreground" title="链接" aria-label="链接" aria-pressed={state.link} onMouseDown={event => event.preventDefault()} onClick={() => run(onLink)}>
        <Link aria-hidden="true" />
      </Button>
      <Button data-icon-button="true" variant="ghost" size="sm" className="markdown-format-button h-7 w-7 shrink-0 px-0 text-muted-foreground" title={`段落源码 (${shortcutLabel})`} aria-label="段落源码" onMouseDown={event => event.preventDefault()} onClick={() => run(onSourcePeek)}>
        <FileCode2 aria-hidden="true" />
      </Button>
    </div>
  )
}
