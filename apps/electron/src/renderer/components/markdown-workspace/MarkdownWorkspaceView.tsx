import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { BookOpen, FileText, Search, Save, PanelLeft, Loader2, MoreHorizontal, Lock, Unlock, Type, Code2, Columns2, X, SlidersHorizontal, Plus, FilePlus, FolderOpen } from 'lucide-react'
import type { MarkdownWorkspaceContext, MarkdownWorkspaceOperation } from '@gamma/shared'
import { currentAgentWorkspaceIdAtom } from '../../atoms/agent-atoms'
import {
  markdownWorkspaceStateAtomFamily,
  markdownSidebarOpenAtom,
  markdownSidebarViewModeAtom,
} from '../../atoms/markdown-workspace-atoms'
import { markdownEditorPreferencesAtom, loadMarkdownEditorPreferencesAtom, updateMarkdownEditorPreferencesAtom } from '../../atoms/markdown-editor-preferences'
import { MarkdownEditorSettingsDialog } from '../settings/MarkdownEditorSettings'
import { markdownEditorStyle, markdownThemeStyle, markdownShortcutMatches } from './markdown-editor-presentation'
import {
  acceptLoadedDocument,
  beginDocumentLoad,
  completeDocumentSave,
  createUntitledDocument,
  closeDocumentTab,
  editDocument,
  isMarkdownDirty,
  setWorkspaceSources,
  removeWorkspaceSource,
} from './markdown-document-controller'
import type { MarkdownDocumentDraft, MarkdownWorkspaceMode } from './markdown-document-controller'
import { MarkdownDocumentList } from './MarkdownDocumentList'
import { MarkdownWorkspaceEditor } from './MarkdownWorkspaceEditor'
import type { MarkdownWorkspaceEditorHandle } from './MarkdownWorkspaceEditor'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import type { MarkdownSourceEditorHandle } from './MarkdownSourceEditor'
import { MarkdownFindBar } from './MarkdownFindBar'
import { markdownFindMatches, markdownOutline, replaceMarkdownMatch, markdownStatistics } from './markdown-reading-tools'
import { formatMarkdownChecked } from './vmark/lib/cjkFormatter/formatter'
import { DEFAULT_CJK_FORMATTING } from './vmark/lib/cjkFormatter/types'
import { VMARK_SOURCE } from './vmark/provenance'
import vmarkLicense from './vmark/LICENSE?raw'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../ui/dropdown-menu'
import './markdown-workspace.css'

interface Props { workspaceId?: string; sessionId?: string }
interface Confirmation { kind: 'format' | 'close' | 'reload'; documentId: string; formatted?: string; original?: string }
const modes: { value: MarkdownWorkspaceMode; label: string }[] = [{ value: 'read', label: '阅读' }, { value: 'rich', label: '富文本' }, { value: 'source', label: '源码' }, { value: 'split', label: '分屏' }]

export function MarkdownWorkspaceView(props: Props): React.ReactElement {
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const context = React.useMemo<MarkdownWorkspaceContext>(() => ({ workspaceId: props.workspaceId ?? currentWorkspaceId ?? undefined, sessionId: props.sessionId }), [props.workspaceId, props.sessionId, currentWorkspaceId])
  const scope = JSON.stringify(context)
  const [state, setState] = useAtom(markdownWorkspaceStateAtomFamily(scope))
  const [sidebarOpen, setSidebarOpen] = useAtom(markdownSidebarOpenAtom)
  const [sidebarViewMode, setSidebarViewMode] = useAtom(markdownSidebarViewModeAtom)
  const store = useStore()
  const preferences = useAtomValue(markdownEditorPreferencesAtom)
  const loadPreferences = useSetAtom(loadMarkdownEditorPreferencesAtom)
  const updatePreferences = useSetAtom(updateMarkdownEditorPreferencesAtom)
  const preferencesLoad = React.useRef<Promise<void> | null>(null)
  const waitForPreferences = React.useCallback(() => {
    preferencesLoad.current ??= loadPreferences().catch(() => { /* 设置页提供可见错误与重试；文档仍使用安全默认值。 */ })
    return preferencesLoad.current
  }, [loadPreferences])
  React.useEffect(() => { void waitForPreferences() }, [waitForPreferences])
  const stateRef = React.useRef(state); stateRef.current = state
  const [showFind, setShowFind] = React.useState(false)
  const [showSettings, setShowSettings] = React.useState(false)
  const showFormatting = preferences.showToolbar
  const setShowFormatting = (value: boolean) => { void updatePreferences({ showToolbar: value }).catch(() => setError('格式工具栏设置保存失败，请重试。')) }
  const [query, setQuery] = React.useState('')
  const [findIndex, setFindIndex] = React.useState(0)
  const [error, setError] = React.useState('')
  const [opening, setOpening] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null)
  const [showLicense, setShowLicense] = React.useState(false)
  const [darkTheme, setDarkTheme] = React.useState(() => document.documentElement.classList.contains('dark'))
  React.useEffect(() => {
    const observer = new MutationObserver(() => setDarkTheme(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const composing = React.useRef(false)
  const compositionEndedAt = React.useRef(0)
  const richRef = React.useRef<MarkdownWorkspaceEditorHandle>(null)
  const sourceRef = React.useRef<MarkdownSourceEditorHandle>(null)
  const active = state.activeId ? state.documents[state.activeId] : undefined
  const request = React.useCallback((input: MarkdownWorkspaceOperation) => window.electronAPI.markdownWorkspace({ ...input, ...context }), [scope, context])

  // 挂载时自动恢复持久化的来源目录
  React.useEffect(() => {
    let cancelled = false
    const restoreSources = async () => {
      try {
        const result = await request({ action: 'restore' })
        if (!cancelled && result.status === 'sources') {
          setState(current => {
            const existingIds = new Set(result.sources.map(s => s.id))
            const remaining = current.sources.filter(s => !existingIds.has(s.id))
            return setWorkspaceSources(current, [...result.sources, ...remaining])
          })
          if (result.sources.some(s => s.kind === 'directory')) {
            setSidebarOpen(true)
          }
        }
      } catch {
        // 静默失败，保持原有状态
      }
    }
    void restoreSources()
    return () => { cancelled = true }
  }, [request, scope, setState])

  const canCommand = () => !composing.current && Date.now() - compositionEndedAt.current > 50
  const patch = (id: string, fields: Partial<MarkdownDocumentDraft>) => setState(current => { const document = current.documents[id]; return document ? { ...current, documents: { ...current.documents, [id]: { ...document, ...fields } } } : current })

  const openDocument = async (sourceId: string, path: string, discard = false) => {
    const key = sourceId + ':' + path + ':' + crypto.randomUUID()
    setError(''); setState(current => beginDocumentLoad(current, key))
    try {
      const result = await request({ action: 'read', sourceId, path })
      if (result.status === 'document') {
        await waitForPreferences()
        const defaultMode = store.get(markdownEditorPreferencesAtom).defaultMode
        setState(current => {
          const documents = { ...current.documents }; if (discard) delete documents[result.document.id]
          return acceptLoadedDocument({ ...current, documents }, key, result.document, defaultMode)
        })
      }
      else if (result.status === 'error') { setError(result.message); setState(current => current.loadingKey === key ? { ...current, loadingKey: null } : current) }
    } catch { setError('文件读取失败。'); setState(current => current.loadingKey === key ? { ...current, loadingKey: null } : current) }
  }

  const choose = async (kind: 'file' | 'directory' | 'project') => {
    if (opening) return
    setOpening(true); setError('')
    try {
      const result = await request(kind === 'project' ? { action: 'project' } : { action: 'choose', kind })
      if (result.status === 'source') {
        setState(current => ({ ...current, sources: current.sources.some(source => source.id === result.source.id) ? current.sources : [...current.sources, result.source] }))
        if (result.source.kind === 'file') await openDocument(result.source.id, '')
        else setSidebarOpen(true)
      } else if (result.status === 'error') setError(result.message)
    } catch { setError('来源选择失败。') }
    finally { setOpening(false) }
  }

  const releaseSource = async (sourceId: string) => {
    try {
      const result = await request({ action: 'release', sourceId })
      if (result.status === 'released') {
        setState(current => removeWorkspaceSource(current, sourceId))
      } else if (result.status === 'error') {
        setError(result.message)
      }
    } catch {
      setError('移除目录失败。')
    }
  }

  const createFileInFolder = async (sourceId: string, path: string, name: string) => {
    try {
      const result = await request({ action: 'create', sourceId, path, name })
      if (result.status === 'document') {
        await waitForPreferences()
        const defaultMode = store.get(markdownEditorPreferencesAtom).defaultMode
        const key = sourceId + ':' + result.document.path + ':' + crypto.randomUUID()
        setState(current => acceptLoadedDocument(current, key, result.document, defaultMode))
      } else if (result.status === 'error') {
        setError(result.message)
      }
    } catch {
      setError('新建文件失败。')
    }
  }

  const newUntitledDocument = () => {
    const defaultMode = store.get(markdownEditorPreferencesAtom).defaultMode
    setState(current => createUntitledDocument(current, defaultMode === 'read' ? 'rich' : defaultMode))
  }

  const save = async (id: string | null = stateRef.current.activeId, saveAs = false) => {
    if (!canCommand() || !id) return
    const document = stateRef.current.documents[id]
    if (!document || document.saving || (!saveAs && !document.writable)) return
    const isUntitled = id.startsWith('untitled:')
    if (isUntitled || saveAs) {
      patch(id, { saving: true })
      try {
        const result = await request({ action: 'save-as', documentId: id, content: document.draft })
        setState(current => completeDocumentSave(current, id, result))
      } catch { patch(id, { saving: false, error: '保存失败，草稿仍保留。' }) }
      return
    }
    patch(id, { saving: true })
    try {
      const result = await request({ action: 'save', documentId: id, content: document.draft, expectedRevision: document.revision })
      setState(current => completeDocumentSave(current, id, result))
    } catch { patch(id, { saving: false, error: '保存失败，草稿仍保留。' }) }
  }

  const changeMode = (mode: MarkdownWorkspaceMode) => {
    if (!active || !canCommand()) return
    patch(active.id, { mode: active.sourceOnly && mode !== 'source' ? 'source' : mode, error: undefined, ...(mode === 'read' ? { editing: false } : mode === 'rich' ? { editing: active.writable } : {}) })
  }

  const toggleEditing = () => {
    if (!active?.writable || !canCommand()) return
    patch(active.id, { editing: !active.editing, mode: active.mode === 'read' ? 'rich' : active.mode })
  }

  const closeTab = (id: string) => setState(current => closeDocumentTab(current, id))

  const format = () => {
    if (!active || !active.editing || !canCommand()) return
    const result = formatMarkdownChecked(active.draft, { ...DEFAULT_CJK_FORMATTING,
      cjkEnglishSpacing: preferences.cjkSpacing, cjkParenthesisSpacing: preferences.cjkSpacing, currencySpacing: preferences.cjkSpacing, slashSpacing: preferences.cjkSpacing, spaceCollapsing: preferences.cjkSpacing, quoteSpacing: preferences.cjkSpacing, singleQuoteSpacing: preferences.cjkSpacing,
      ellipsisNormalization: preferences.cjkPunctuation, dashConversion: preferences.cjkPunctuation, emdashSpacing: preferences.cjkPunctuation, smartQuoteConversion: preferences.cjkPunctuation,
      fullwidthAlphanumeric: preferences.cjkFullwidth, fullwidthPunctuation: preferences.cjkFullwidth, fullwidthParentheses: preferences.cjkFullwidth,
    })
    if (result.refused) setError('排版完整性检查未通过，未修改正文。')
    else if (result.text === active.draft) setError('当前文本不需要排版调整。')
    else setConfirmation({ kind: 'format', documentId: active.id, original: active.draft, formatted: result.text })
  }

  React.useEffect(() => { setQuery(''); setFindIndex(0); setConfirmation(null); setError('') }, [scope, state.activeId])
  React.useEffect(() => {
    const dirty = Object.values(state.documents).some(isMarkdownDirty)
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state.documents])

  const outline = React.useMemo(() => markdownOutline(active?.draft ?? ''), [active?.draft])
  const statistics = React.useMemo(() => markdownStatistics(active?.draft ?? ''), [active?.draft])
  const matches = React.useMemo(() => markdownFindMatches(active?.draft ?? '', query), [active?.draft, query])

  React.useEffect(() => { if (query && matches.length) sourceRef.current?.scrollTo(matches[findIndex % matches.length]!.from) }, [query, findIndex, state.activeId])

  const replace = (replacement: string, all: boolean) => {
    if (!active?.editing || !canCommand()) return
    let source = active.draft
    if (all) for (const match of [...matches].reverse()) source = source.slice(0, match.from) + replacement + source.slice(match.to)
    else source = replaceMarkdownMatch(source, query, replacement, findIndex)
    setState(current => editDocument(current, active.id, source)); patch(active.id, { mode: 'source' })
  }

  const rootKeydown = (event: React.KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return
    if (event.defaultPrevented || !canCommand() || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setShowFind(true) }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebarOpen(v => !v) }
    if (markdownShortcutMatches(event, preferences.shortcuts.toggleSource) && active && !active.sourceOnly) { event.preventDefault(); changeMode(active.mode === 'source' ? active.editing ? 'rich' : 'read' : 'source') }
    if (markdownShortcutMatches(event, preferences.shortcuts.toggleEdit)) { event.preventDefault(); toggleEditing() }
    if (markdownShortcutMatches(event, preferences.shortcuts.sourcePeek) && active && active.mode !== 'source') { event.preventDefault(); richRef.current?.openSourcePeek() }
  }

  const rich = active && <MarkdownWorkspaceEditor key={active.id} ref={richRef} documentId={active.id} value={active.draft} editing={active.editing && (active.mode === 'rich' || active.mode === 'read')} showToolbar={showFormatting} preferences={preferences} onChange={content => setState(current => editDocument(current, active.id, content))} onSave={() => { void save(active.id) }} resolveMedia={async src => { const result = await request({ action: 'media', documentId: active.id, src }); return result.status === 'media' ? result.url : null }} onError={reason => { patch(active.id, { mode: 'source', error: reason }) }} theme={(preferences.theme === 'inherit' ? darkTheme : preferences.theme === 'night' || preferences.theme === 'solarized') ? 'github-dark' : 'github-light'} query={query} findIndex={findIndex} initialScrollTop={active.scrollTop} onScroll={scrollTop => patch(active.id, { scrollTop })} />
  const source = active && <MarkdownSourceEditor key={active.id} ref={sourceRef} value={active.draft} readOnly={!active.editing} preferences={preferences} onChange={content => setState(current => editDocument(current, active.id, content))} onSave={() => { void save(active.id) }} initialScrollTop={active.scrollTop} onScroll={scrollTop => patch(active.id, { scrollTop })} />

  return (
    <section
      className="markdown-workspace-view flex h-full min-h-0 flex-col bg-background"
      aria-label="Markdown 工作区"
      style={markdownEditorStyle(preferences)}
      data-table-fit={preferences.tableFit}
      data-testid="markdown-workspace"
      onKeyDown={rootKeydown}
      onCompositionStartCapture={() => { composing.current = true }}
      onCompositionEndCapture={() => { composing.current = false; compositionEndedAt.current = Date.now() }}
    >
      {(error || active?.error) && (
        <div className="flex items-start gap-2 border-b bg-muted p-2 text-xs" role="alert">
          <span className="flex-1">{error || active?.error}</span>
          <Button variant="ghost" className="h-5 px-1 text-xs" onClick={() => { setError(''); if (active) patch(active.id, { error: undefined }) }} aria-label="关闭提示">×</Button>
        </div>
      )}

      {showFind && active && (
        <MarkdownFindBar
          query={query}
          onQuery={value => { setQuery(value); setFindIndex(0) }}
          count={matches.length}
          index={findIndex}
          onNext={delta => setFindIndex(value => (value + delta + Math.max(matches.length, 1)) % Math.max(matches.length, 1))}
          editing={active.editing}
          onReplace={replace}
          onClose={() => { setShowFind(false); setQuery('') }}
        />
      )}

      <div className="markdown-workspace-body relative flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <MarkdownDocumentList
            key={scope}
            context={context}
            sources={state.sources}
            activePath={active?.path}
            activeSourceId={active?.sourceId}
            outlineEntries={outline}
            onOpen={(id, path) => { void openDocument(id, path) }}
            onAddFolder={() => { void choose('directory') }}
            onOpenProject={() => { void choose('project') }}
            onReleaseSource={id => { void releaseSource(id) }}
            onCreateFile={(sourceId, path, name) => { void createFileInFolder(sourceId, path, name) }}
            onJumpOutline={entry => {
              if (active) {
                active.mode === 'source' || active.mode === 'split'
                  ? sourceRef.current?.scrollTo(entry.offset)
                  : richRef.current?.scrollToLine(entry.line, entry.index)
              }
            }}
            onCloseSidebar={() => setSidebarOpen(false)}
            onError={setError}
          />
        )}

        <main className="min-w-0 flex-1 overflow-hidden">
          {active ? (
            <div className={`markdown-workspace-panes h-full min-h-0 ${active.mode === 'split' ? 'markdown-workspace-split' : ''}`}>
              <div className="markdown-workspace-source-pane min-w-0 overflow-hidden" hidden={active.mode !== 'source' && active.mode !== 'split' && !active.sourceOnly}>
                {source}
              </div>
              {!active.sourceOnly && (
                <div className="markdown-workspace-rich-pane min-w-0 overflow-hidden" hidden={active.mode === 'source'}>
                  {rich}
                </div>
              )}
            </div>
          ) : (
            <div className="markdown-welcome-screen flex h-full flex-col items-center justify-center p-6 text-center select-none overflow-y-auto">
              <div className="max-w-md w-full flex flex-col items-center gap-6 my-auto py-8">
                <div className="space-y-2">
                  <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-muted/70 text-foreground mb-1 shadow-sm">
                    <BookOpen className="size-6 stroke-[1.75]" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">Gamma Markdown</h1>
                  <p className="text-sm text-muted-foreground">专注、优雅的本地 Markdown 写作与阅读</p>
                </div>

                <div className="flex flex-wrap justify-center gap-2.5">
                  <Button variant="default" size="sm" className="rounded-full px-4 gap-1.5 shadow-sm" onClick={newUntitledDocument}>
                    <Plus className="size-3.5" />
                    <span>新建文档</span>
                  </Button>
                  <Button variant="secondary" size="sm" className="rounded-full px-4 gap-1.5" onClick={() => { void choose('file') }}>
                    <FileText className="size-3.5" />
                    <span>打开 Markdown</span>
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-full px-4 gap-1.5" onClick={() => { void choose('directory') }}>
                    <FolderOpen className="size-3.5" />
                    <span>打开目录</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="rounded-full px-3 text-muted-foreground hover:text-foreground" onClick={() => { void choose('project') }}>
                    当前项目
                  </Button>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground/80 mt-2">
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground border">⌘ S</kbd>
                  <span>保存</span>
                  <span className="text-muted-foreground/40">·</span>
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground border">⌘ F</kbd>
                  <span>查找</span>
                  <span className="text-muted-foreground/40">·</span>
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground border">⌘ B</kbd>
                  <span>侧栏</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="markdown-workspace-status" data-testid="markdown-workspace-status">
        <Button
          variant="ghost"
          size="icon"
          className="markdown-status-button"
          title="文件来源"
          aria-label="文件来源"
          aria-pressed={sidebarOpen && sidebarViewMode === 'files'}
          onClick={() => {
            if (sidebarOpen && sidebarViewMode === 'files') {
              setSidebarOpen(false)
            } else {
              setSidebarOpen(true)
              setSidebarViewMode('files')
            }
          }}
        >
          <PanelLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="markdown-status-button"
          title="打开 Markdown"
          aria-label="打开 Markdown"
          disabled={opening}
          onClick={() => { void choose('file') }}
        >
          {opening ? <Loader2 className="animate-spin" /> : <FileText />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="markdown-status-button"
          title="新建空白文档"
          aria-label="新建空白文档"
          onClick={newUntitledDocument}
        >
          <Plus />
        </Button>

        <nav className="markdown-document-tabs" aria-label="Markdown 文档标签">
          {state.tabs.map(id => {
            const item = state.documents[id]
            if (!item) return null
            const isActive = state.activeId === id
            const dirty = isMarkdownDirty(item)
            return (
              <div key={id} className={`tab-pill markdown-document-tab ${isActive ? 'is-active active' : ''}`}>
                <button
                  type="button"
                  className="markdown-document-tab-name"
                  title={item.name}
                  aria-label={item.name}
                  aria-pressed={isActive}
                  onClick={() => setState(current => ({ ...current, activeId: id, loadingKey: null }))}
                >
                  <span className="truncate">{item.name}</span>
                  {dirty && <span className="tab-dirty-dot markdown-document-dirty" aria-label="未保存">•</span>}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="tab-strip-close markdown-document-tab-close"
                  aria-label={`关闭 ${item.name}`}
                  onClick={e => {
                    e.stopPropagation()
                    dirty ? setConfirmation({ kind: 'close', documentId: id }) : closeTab(id)
                  }}
                >
                  <X />
                </Button>
              </div>
            )
          })}
        </nav>

        <span className="markdown-document-statistics" title="字词按中文分词及 Unicode 边界统计；字符不含空白。">
          {state.loadingKey ? '读取中…' : active ? `${statistics.words.toLocaleString()} 字词 · ${statistics.characters.toLocaleString()} 字符` : ''}
        </span>

        {active && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="markdown-status-button markdown-status-secondary"
              title="查找文本 (⌘F)"
              aria-label="查找文本"
              aria-pressed={showFind}
              onClick={() => setShowFind(value => !value)}
            >
              <Search />
            </Button>
            {active.editing && (active.mode === 'read' || active.mode === 'rich') && (
              <Button
                variant="ghost"
                size="icon"
                className="markdown-status-button"
                title="格式工具栏"
                aria-label="格式工具栏"
                aria-pressed={showFormatting}
                onClick={() => setShowFormatting(!showFormatting)}
              >
                <SlidersHorizontal />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="markdown-status-button"
                  aria-label="切换 Markdown 视图"
                  title={`${active.mode === 'source' ? '源码' : active.mode === 'split' ? '分屏' : '可视化'} (${preferences.shortcuts.toggleSource})`}
                >
                  {active.mode === 'source' ? <Code2 /> : active.mode === 'split' ? <Columns2 /> : <Type />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent style={markdownThemeStyle(preferences.theme)} side="top" align="end">
                <DropdownMenuRadioGroup
                  value={active.mode}
                  onValueChange={value => {
                    const mode = modes.find(item => item.value === value)
                    if (mode) changeMode(mode.value)
                  }}
                >
                  {modes.map(mode => (
                    <DropdownMenuRadioItem key={mode.value} value={mode.value} disabled={active.sourceOnly && mode.value !== 'source'}>
                      {mode.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="markdown-status-button"
              aria-label={active.editing ? '结束编辑' : '编辑'}
              aria-pressed={active.editing}
              title={active.editing ? `锁定为只读 (${preferences.shortcuts.toggleEdit})` : `解锁编辑 (${preferences.shortcuts.toggleEdit})`}
              disabled={!active.writable}
              onClick={toggleEditing}
            >
              {active.editing ? <Unlock /> : <Lock />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={`markdown-status-button ${isMarkdownDirty(active) ? 'text-foreground' : ''}`}
              aria-label="保存"
              title={active.conflict ? '保存冲突，请另存草稿' : isMarkdownDirty(active) ? '保存草稿 (⌘S)' : '已保存'}
              disabled={!active.writable || active.saving || !isMarkdownDirty(active)}
              onClick={() => { void save(active.id) }}
            >
              {active.saving ? <Loader2 className="animate-spin" /> : <Save />}
            </Button>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="markdown-status-button" aria-label="更多 Markdown 操作" title="更多操作">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={markdownThemeStyle(preferences.theme)} side="top" align="end">
            <DropdownMenuItem onSelect={() => setShowSettings(true)}>文档设置…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={opening} onSelect={() => { void choose('directory') }}>打开目录</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { void choose('project') }}>打开当前项目</DropdownMenuItem>
            <DropdownMenuItem disabled={!active} onSelect={() => { if (active) void save(active.id, true) }}>另存为…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!active} onSelect={() => { setSidebarOpen(true); setSidebarViewMode('outline') }}>文档目录</DropdownMenuItem>
            <DropdownMenuItem disabled={!active} onSelect={() => setShowFind(true)}>查找文本</DropdownMenuItem>
            <DropdownMenuItem disabled={!active?.editing} onSelect={format}>中文排版…</DropdownMenuItem>
            <DropdownMenuItem
              disabled={!active?.editing || !active.formatUndo || active.draft !== active.formatUndo.after}
              onSelect={() => {
                if (active?.formatUndo && canCommand()) {
                  setState(current => editDocument(current, active.id, active.formatUndo!.before))
                  patch(active.id, { formatUndo: undefined })
                }
              }}
            >
              撤销中文排版
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!active} onSelect={() => { if (active) setConfirmation({ kind: 'reload', documentId: active.id }) }}>重新读取磁盘…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShowLicense(true)}>上游来源与许可证</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="sr-only" role="status">
          {active?.sourceOnly ? '大文件 · 仅源码' : active?.editing ? '编辑中' : '只读阅读'}
          {active && (active.conflict ? ' · 保存冲突' : isMarkdownDirty(active) ? ' · 未保存草稿' : ' · 已保存')}
        </span>
      </footer>

      <MarkdownEditorSettingsDialog open={showSettings} onOpenChange={setShowSettings} />

      <Dialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null) }}>
        <DialogContent style={markdownThemeStyle(preferences.theme)}>
          <DialogHeader>
            <DialogTitle>
              {confirmation?.kind === 'format' ? '确认中文排版' : confirmation?.kind === 'close' ? '保留未保存草稿' : '重新读取磁盘'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmation?.kind === 'format'
              ? '排版不会自动保存。应用后可在更多菜单中撤销中文排版。'
              : confirmation?.kind === 'close'
              ? '关闭文档标签时保留草稿。再次打开相同文档可继续编辑。'
              : '将用磁盘文件替换当前草稿。存在外部修改时请先另存草稿。'}
          </p>
          {confirmation?.kind === 'format' && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
              {confirmation.formatted?.slice(0, 5000)}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>取消</Button>
            <Button onClick={() => {
              if (!confirmation || !canCommand()) return
              const item = stateRef.current.documents[confirmation.documentId]
              if (confirmation.kind === 'format' && item) {
                if (item.draft !== confirmation.original) { setError('草稿已变化，请重新预览排版。'); setConfirmation(null); return }
                patch(item.id, { mode: 'source', formatUndo: { before: item.draft, after: confirmation.formatted ?? item.draft } })
                setState(current => editDocument(current, item.id, confirmation.formatted ?? item.draft))
              } else if (confirmation.kind === 'close') {
                closeTab(confirmation.documentId)
              } else if (item) {
                void openDocument(item.sourceId, item.path, true)
              }
              setConfirmation(null)
            }}>
              {confirmation?.kind === 'format' ? '应用到草稿' : confirmation?.kind === 'close' ? '保留草稿并关闭' : '读取并替换草稿'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLicense} onOpenChange={setShowLicense}>
        <DialogContent style={markdownThemeStyle(preferences.theme)}>
          <DialogHeader><DialogTitle>VMark 核心来源</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">模块化移植，并非官方 VMark 桌面应用。{VMARK_SOURCE.repository}<br />Commit: {VMARK_SOURCE.commit}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{vmarkLicense}</pre>
        </DialogContent>
      </Dialog>
    </section>
  )
}
export default MarkdownWorkspaceView
