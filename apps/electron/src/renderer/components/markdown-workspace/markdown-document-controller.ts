import type { MarkdownWorkspaceDocument, MarkdownWorkspaceResult, MarkdownWorkspaceSource } from '@gamma/shared'

export type MarkdownWorkspaceMode = 'read' | 'rich' | 'source' | 'split'
export interface MarkdownDocumentDraft extends MarkdownWorkspaceDocument {
  draft: string
  savedContent: string
  mode: MarkdownWorkspaceMode
  editing: boolean
  scrollTop: number
  saving: boolean
  error?: string
  conflict?: boolean
  formatUndo?: { before: string; after: string }
}
export interface MarkdownWorkspaceState {
  sources: MarkdownWorkspaceSource[]
  documents: Record<string, MarkdownDocumentDraft>
  tabs: string[]
  activeId: string | null
  loadingKey: string | null
}
export function initialMarkdownWorkspaceState(): MarkdownWorkspaceState {
  return { sources: [], documents: {}, tabs: [], activeId: null, loadingKey: null }
}
export function isMarkdownDirty(document: MarkdownDocumentDraft): boolean { return document.draft !== document.savedContent }
export function beginDocumentLoad(state: MarkdownWorkspaceState, key: string): MarkdownWorkspaceState {
  return { ...state, loadingKey: key }
}
export function acceptLoadedDocument(state: MarkdownWorkspaceState, key: string, document: MarkdownWorkspaceDocument, defaultMode: MarkdownWorkspaceMode = 'rich'): MarkdownWorkspaceState {
  const existing = state.documents[document.id]
  // 普通打开不覆盖未保存草稿；重新读取丢弃草稿必须由 UI 单独确认后移除旧文档。
  const draft: MarkdownDocumentDraft = existing && isMarkdownDirty(existing) ? existing : {
    ...document, draft: document.content, savedContent: document.content,
    mode: document.sourceOnly ? 'source' : existing?.mode ?? defaultMode, editing: document.writable && (existing?.editing ?? (!document.sourceOnly && defaultMode === 'rich')),
    scrollTop: existing?.scrollTop ?? 0, saving: false,
  }
  const current = state.loadingKey === key
  return { ...state, documents: { ...state.documents, [document.id]: draft }, tabs: state.tabs.includes(document.id) ? state.tabs : [...state.tabs, document.id], activeId: current ? document.id : state.activeId, loadingKey: current ? null : state.loadingKey }
}
export function editDocument(state: MarkdownWorkspaceState, id: string, content: string): MarkdownWorkspaceState {
  const document = state.documents[id]
  return document ? { ...state, documents: { ...state.documents, [id]: { ...document, draft: content, error: undefined } } } : state
}
export function completeDocumentSave(state: MarkdownWorkspaceState, id: string, result: MarkdownWorkspaceResult): MarkdownWorkspaceState {
  const current = state.documents[id]
  if (!current) return state
  if (result.status === 'error') return { ...state, documents: { ...state.documents, [id]: { ...current, saving: false, error: result.message, conflict: result.code === 'conflict' } } }
  if (result.status !== 'saved') return { ...state, documents: { ...state.documents, [id]: { ...current, saving: false } } }
  if (result.document.id !== id) {
    const added = acceptLoadedDocument({ ...state, loadingKey: result.document.id }, result.document.id, result.document)
    return { ...added, activeId: state.activeId === id ? added.activeId : state.activeId, sources: result.source && !added.sources.some(source => source.id === result.source?.id) ? [...added.sources, result.source] : added.sources, documents: { ...added.documents, [id]: { ...current, saving: false } } }
  }
  return { ...state, documents: { ...state.documents, [id]: { ...current, content: result.document.content, revision: result.document.revision, savedContent: result.document.content, saving: false, error: undefined, conflict: false } } }
}

export function createUntitledDocument(
  state: MarkdownWorkspaceState,
  defaultMode: MarkdownWorkspaceMode = 'rich',
): MarkdownWorkspaceState {
  let count = 1
  const existingNames = new Set(Object.values(state.documents).map(d => d.name))
  while (existingNames.has(`Untitled-${count}.md`)) count++
  const id = `untitled:${crypto.randomUUID()}`
  const name = `Untitled-${count}.md`
  const untitledDoc: MarkdownDocumentDraft = {
    id, sourceId: '', name, path: '', content: '', revision: 'new',
    writable: true, sourceOnly: false, draft: '', savedContent: '',
    mode: defaultMode, editing: true, scrollTop: 0, saving: false,
  }
  return {
    ...state,
    documents: { ...state.documents, [id]: untitledDoc },
    tabs: [...state.tabs, id],
    activeId: id,
    loadingKey: null,
  }
}

export function closeDocumentTab(
  state: MarkdownWorkspaceState,
  id: string,
): MarkdownWorkspaceState {
  const tabs = state.tabs.filter(tabId => tabId !== id)
  const documents = { ...state.documents }
  if (id.startsWith('untitled:') && documents[id]?.draft === '') {
    delete documents[id]
  }
  let activeId = state.activeId
  if (state.activeId === id) {
    const closedIndex = state.tabs.indexOf(id)
    activeId = tabs[closedIndex] ?? tabs[closedIndex - 1] ?? tabs.at(-1) ?? null
  }
  return { ...state, tabs, documents, activeId }
}

export function setWorkspaceSources(
  state: MarkdownWorkspaceState,
  sources: MarkdownWorkspaceSource[],
): MarkdownWorkspaceState {
  return { ...state, sources }
}

export function addWorkspaceSource(
  state: MarkdownWorkspaceState,
  source: MarkdownWorkspaceSource,
): MarkdownWorkspaceState {
  if (state.sources.some(s => s.id === source.id)) return state
  return { ...state, sources: [...state.sources, source] }
}

export function removeWorkspaceSource(
  state: MarkdownWorkspaceState,
  sourceId: string,
): MarkdownWorkspaceState {
  const sources = state.sources.filter(s => s.id !== sourceId)
  const tabsToKeep = state.tabs.filter(tabId => {
    const doc = state.documents[tabId]
    return !doc || doc.sourceId !== sourceId
  })
  const activeId = tabsToKeep.includes(state.activeId ?? '')
    ? state.activeId
    : (tabsToKeep.at(-1) ?? null)
  return { ...state, sources, tabs: tabsToKeep, activeId }
}
