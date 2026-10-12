/** Markdown 工作区使用主进程授予的来源，不接受 renderer 任意目录授权。 */
export interface MarkdownWorkspaceContext {
  workspaceId?: string
  sessionId?: string
}
export interface MarkdownWorkspaceSource {
  id: string
  name: string
  kind: 'file' | 'directory'
}
export interface MarkdownWorkspaceEntry {
  name: string
  /** 来源内相对路径；单文件来源使用空串。 */
  path: string
  kind: 'file' | 'directory'
}
export interface MarkdownWorkspaceDocument {
  id: string
  sourceId: string
  name: string
  path: string
  content: string
  revision: string
  writable: boolean
  sourceOnly: boolean
}
export type MarkdownWorkspaceOperation = (
  | { action: 'choose'; kind: 'file' | 'directory' }
  | { action: 'project' }
  | { action: 'restore' }
  | { action: 'create'; sourceId: string; path: string; name: string }
  | { action: 'list'; sourceId: string; path: string }
  | { action: 'read'; sourceId: string; path: string }
  | { action: 'save'; documentId: string; content: string; expectedRevision: string }
  | { action: 'save-as'; documentId: string; content: string }
  | { action: 'media'; documentId: string; src: string }
  | { action: 'release'; sourceId: string }
)
export type MarkdownWorkspaceRequest = MarkdownWorkspaceContext & MarkdownWorkspaceOperation
export type MarkdownWorkspaceResult =
  | { status: 'source'; source: MarkdownWorkspaceSource }
  | { status: 'sources'; sources: MarkdownWorkspaceSource[] }
  | { status: 'entries'; entries: MarkdownWorkspaceEntry[] }
  | { status: 'document' | 'saved'; document: MarkdownWorkspaceDocument; source?: MarkdownWorkspaceSource }
  | { status: 'media'; url: string | null }
  | { status: 'released' | 'cancelled' }
  | { status: 'error'; code: 'denied' | 'missing' | 'too-large' | 'conflict' | 'invalid' | 'io'; message: string }

/** 独立文档编辑器偏好，不影响 AI 回复的 Markdown 字号。 */
export interface MarkdownEditorPreferences {
  theme: 'inherit' | 'white' | 'paper' | 'mint' | 'sepia' | 'night' | 'solarized'
  latinFont: 'system' | 'serif' | 'sans'
  cjkFont: 'system' | 'song' | 'hei' | 'kai'
  monoFont: 'system' | 'menlo' | 'monaco'
  fontSize: 14 | 16 | 18 | 20 | 22 | 24
  lineHeight: 1.4 | 1.6 | 1.8 | 2
  blockSpacing: 0.75 | 1 | 1.5 | 2
  letterSpacing: 0 | 0.02 | 0.05
  /** 单位 em；0 表示不限制正文宽度。 */
  contentWidth: 36 | 50 | 64 | 0
  defaultMode: 'read' | 'rich' | 'source' | 'split'
  showToolbar: boolean
  sourceLineNumbers: boolean
  sourceWordWrap: boolean
  tabSize: 2 | 4
  headingAlign: 'left' | 'center'
  tableFit: boolean
  cjkSpacing: boolean
  cjkPunctuation: boolean
  cjkFullwidth: boolean
  shortcuts: {
    sourcePeek: string
    toggleSource: string
    toggleEdit: string
  }
}

/** IPC 接受局部偏好，快捷键逐项合并。 */
export interface MarkdownEditorPreferencesUpdate extends Partial<Omit<MarkdownEditorPreferences, 'shortcuts'>> {
  shortcuts?: Partial<MarkdownEditorPreferences['shortcuts']>
}

export const DEFAULT_MARKDOWN_EDITOR_PREFERENCES: MarkdownEditorPreferences = {
  theme: 'inherit', latinFont: 'system', cjkFont: 'system', monoFont: 'system',
  fontSize: 18, lineHeight: 1.8, blockSpacing: 1, letterSpacing: 0, contentWidth: 50,
  defaultMode: 'rich', showToolbar: false, sourceLineNumbers: true, sourceWordWrap: true,
  tabSize: 2, headingAlign: 'left', tableFit: false,
  cjkSpacing: true, cjkPunctuation: true, cjkFullwidth: true,
  shortcuts: { sourcePeek: 'F5', toggleSource: 'F6', toggleEdit: 'F10' },
}

function preferenceRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function preferenceChoice<T extends string | number>(input: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(input as T) ? input as T : fallback
}

/** 文档快捷键使用 F1–F12，避免与应用及原生文本编辑快捷键冲突。 */
export function isMarkdownEditorShortcut(input: unknown): input is string {
  return typeof input === 'string' && /^F([1-9]|1[0-2])$/i.test(input)
}

/** 容错读取旧配置、手写 JSON 与不可信 IPC 输入，始终返回完整偏好。 */
export function normalizeMarkdownEditorPreferences(input: unknown): MarkdownEditorPreferences {
  const raw = preferenceRecord(input)
  const shortcuts = preferenceRecord(raw.shortcuts)
  const defaults = DEFAULT_MARKDOWN_EDITOR_PREFERENCES
  const booleanPreference = (key: keyof MarkdownEditorPreferences): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] as boolean : defaults[key] as boolean
  const shortcut = (key: keyof MarkdownEditorPreferences['shortcuts']): string =>
    isMarkdownEditorShortcut(shortcuts[key]) ? (shortcuts[key] as string).toUpperCase() : defaults.shortcuts[key]
  const normalizedShortcuts = { sourcePeek: shortcut('sourcePeek'), toggleSource: shortcut('toggleSource'), toggleEdit: shortcut('toggleEdit') }
  return {
    theme: preferenceChoice(raw.theme, ['inherit', 'white', 'paper', 'mint', 'sepia', 'night', 'solarized'], defaults.theme),
    latinFont: preferenceChoice(raw.latinFont, ['system', 'serif', 'sans'], defaults.latinFont),
    cjkFont: preferenceChoice(raw.cjkFont, ['system', 'song', 'hei', 'kai'], defaults.cjkFont),
    monoFont: preferenceChoice(raw.monoFont, ['system', 'menlo', 'monaco'], defaults.monoFont),
    fontSize: preferenceChoice(raw.fontSize, [14, 16, 18, 20, 22, 24], defaults.fontSize),
    lineHeight: preferenceChoice(raw.lineHeight, [1.4, 1.6, 1.8, 2], defaults.lineHeight),
    blockSpacing: preferenceChoice(raw.blockSpacing, [0.75, 1, 1.5, 2], defaults.blockSpacing),
    letterSpacing: preferenceChoice(raw.letterSpacing, [0, 0.02, 0.05], defaults.letterSpacing),
    contentWidth: preferenceChoice(raw.contentWidth, [36, 50, 64, 0], defaults.contentWidth),
    defaultMode: preferenceChoice(raw.defaultMode, ['read', 'rich', 'source', 'split'], defaults.defaultMode),
    showToolbar: booleanPreference('showToolbar'),
    sourceLineNumbers: booleanPreference('sourceLineNumbers'),
    sourceWordWrap: booleanPreference('sourceWordWrap'),
    tabSize: preferenceChoice(raw.tabSize, [2, 4], defaults.tabSize),
    headingAlign: preferenceChoice(raw.headingAlign, ['left', 'center'], defaults.headingAlign),
    tableFit: booleanPreference('tableFit'),
    cjkSpacing: booleanPreference('cjkSpacing'),
    cjkPunctuation: booleanPreference('cjkPunctuation'),
    cjkFullwidth: booleanPreference('cjkFullwidth'),
    // 重复绑定会一次触发多个操作；损坏配置回退到互不冲突的默认组合。
    shortcuts: new Set(Object.values(normalizedShortcuts)).size === 3 ? normalizedShortcuts : { ...defaults.shortcuts },
  }
}

export function mergeMarkdownEditorPreferences(current: unknown, updates: unknown): MarkdownEditorPreferences {
  const base = normalizeMarkdownEditorPreferences(current)
  const patch = preferenceRecord(updates)
  return normalizeMarkdownEditorPreferences({ ...base, ...patch, shortcuts: { ...base.shortcuts, ...preferenceRecord(patch.shortcuts) } })
}
