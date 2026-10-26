import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Palette, Type, FileText, Languages, Keyboard, RotateCcw, Search } from 'lucide-react'
import type { MarkdownEditorPreferences } from '@gamma/shared'
import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES } from '@gamma/shared'
import { markdownEditorPreferencesAtom, markdownEditorPreferencesErrorAtom, markdownEditorPreferencesSavingAtom, loadMarkdownEditorPreferencesAtom, updateMarkdownEditorPreferencesAtom } from '@/atoms/markdown-editor-preferences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { MARKDOWN_DOCUMENT_THEMES, markdownEditorStyle, markdownThemeStyle } from '../markdown-workspace/markdown-editor-presentation'
import '../markdown-workspace/markdown-workspace.css'

import { SettingsSection, SettingsCard, SettingsRow, SettingsToggle } from './primitives'
import { FadeTitle } from '@/components/ui/fade-title'

type Category = 'appearance' | 'editor' | 'markdown' | 'cjk' | 'shortcuts'
interface CategoryItem { id: Category; label: string; icon: React.ReactNode }
const categories: CategoryItem[] = [
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'editor', label: '编辑器', icon: <Type size={16} /> },
  { id: 'markdown', label: 'Markdown', icon: <FileText size={16} /> },
  { id: 'cjk', label: '中文排版', icon: <Languages size={16} /> },
  { id: 'shortcuts', label: '快捷键', icon: <Keyboard size={16} /> },
]
interface SettingRowProps { label: string; description?: string; children: React.ReactNode }
function SettingRow({ label, description, children }: SettingRowProps): React.ReactElement {
  return <div className="markdown-setting-row"><div className="min-w-0"><div className="text-sm font-medium">{label}</div>{description && <p className="mt-1 max-w-[42ch] text-xs leading-relaxed text-muted-foreground">{description}</p>}</div><div className="markdown-setting-control">{children}</div></div>
}
interface Option { value: string; label: string }
interface Choice { key: keyof MarkdownEditorPreferences; label: string; description?: string; options: Option[] }
const numericOptions = (values: number[], unit = ''): Option[] => values.map(value => ({ value: String(value), label: `${value}${unit}` }))
const editorChoices: Choice[] = [
  { key: 'latinFont', label: '拉丁字体', description: '西文字符与数字优先使用的字体族', options: [{ value: 'system', label: '跟随全局字体' }, { value: 'serif', label: 'Source Serif 4（衬线）' }, { value: 'sans', label: 'Inter（无衬线）' }] },
  { key: 'cjkFont', label: 'CJK 字体', description: '正文优先使用随应用打包的 Noto Serif SC，回退 Songti SC。', options: [{ value: 'system', label: '跟随全局字体' }, { value: 'song', label: '宋体' }, { value: 'hei', label: '黑体' }, { value: 'kai', label: '楷体' }] },
  { key: 'monoFont', label: '等宽字体', description: '代码块与行内代码使用的等宽字体族', options: [{ value: 'system', label: '跟随全局字体' }, { value: 'menlo', label: 'Menlo' }, { value: 'monaco', label: 'Monaco' }] },
  { key: 'fontSize', label: '字体大小', description: '正文基础字号大小', options: numericOptions([14, 15.5, 16, 18, 20, 22, 24], 'px') },
  { key: 'lineHeight', label: '正文行高', description: '正文文本行间距倍数', options: numericOptions([1.4, 1.6, 1.7, 1.8, 2]) },
  { key: 'blockSpacing', label: '段落间距', description: '段落与标题之间的垂直间距倍数', options: numericOptions([0.75, 1, 1.5, 2], '×') },
  { key: 'letterSpacing', label: '字间距', description: '汉字与西文字符间隙微调', options: [{ value: '0', label: '关闭' }, { value: '0.02', label: '0.02em' }, { value: '0.05', label: '0.05em' }] },
  { key: 'contentWidth', label: '编辑器宽度', description: '正文居中显示，最大行宽不超过全局 680px', options: [{ value: '36', label: '36em（窄）' }, { value: '50', label: '50em（中等）' }, { value: '64', label: '64em（宽）' }, { value: '0', label: '跟随全局行宽（680px）' }] },
  { key: 'tabSize', label: '制表符大小', description: '源码模式按下 Tab 键时的缩进空格数', options: [{ value: '2', label: '2 个空格' }, { value: '4', label: '4 个空格' }] },
]
const markdownChoices: Choice[] = [
  { key: 'defaultMode', label: '默认视图', description: '首次打开新文档时默认使用的呈现模式', options: [{ value: 'read', label: '阅读（只读）' }, { value: 'rich', label: '富文本编辑' }, { value: 'source', label: '源码（只读）' }, { value: 'split', label: '源码与预览（只读）' }] },
  { key: 'headingAlign', label: '标题对齐', description: '文档各级标题在正文中的水平对齐方式', options: [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }] },
]
interface Toggle { key: 'showToolbar' | 'sourceLineNumbers' | 'sourceWordWrap' | 'tableFit' | 'cjkSpacing' | 'cjkPunctuation' | 'cjkFullwidth'; label: string; description?: string }
const editorToggles: Toggle[] = [
  { key: 'showToolbar', label: '显示格式工具栏', description: '富文本编辑时在正文下方显示；也可随时从底栏切换。' },
  { key: 'sourceLineNumbers', label: '源码行号', description: '在源码编辑视图中显示行号指示。' },
  { key: 'sourceWordWrap', label: '源码自动换行', description: '源码模式下长文本超出编辑器宽度时自动折行。' },
]
const cjkToggles: Toggle[] = [
  { key: 'cjkSpacing', label: '中英文间距', description: '处理中英文、括号、货币与斜杠之间的间距。' },
  { key: 'cjkPunctuation', label: '标点与引号统一', description: '统一中文省略号、破折号和上下文配对引号。' },
  { key: 'cjkFullwidth', label: '全角字符规范化', description: '统一全角字母、数字、标点与括号。代码、链接和公式保持原样。' },
]
const tableToggle: Toggle = { key: 'tableFit', label: '表格适应宽度', description: '将表格约束在正文宽度内，长内容自动换行。' }
const shortcutOptions = Array.from({ length: 12 }, (_, index) => `F${index + 1}`)
const shortcutRows: { key: keyof MarkdownEditorPreferences['shortcuts']; label: string; description: string }[] = [
  { key: 'sourcePeek', label: '段落源码', description: '快捷查看并编辑当前段落的 Markdown 源码' },
  { key: 'toggleSource', label: '切换源码视图', description: '在富文本编辑与源码模式间快速切换' },
  { key: 'toggleEdit', label: '锁定或解锁编辑', description: '快速在只读阅读模式与编辑模式间切换' },
]
const staticShortcuts: [string, string][] = [
  ['保存', '⌘ / Ctrl + S'],
  ['查找', '⌘ / Ctrl + F'],
  ['粗体', '⌘ / Ctrl + B'],
  ['斜体', '⌘ / Ctrl + I'],
  ['撤销', '⌘ / Ctrl + Z'],
  ['应用段落源码', '⌘ / Ctrl + Enter'],
  ['取消段落源码', 'Esc'],
]

/**
 * 全量设置页组件（用于应用主设置面板 SettingsPanel）
 * 彻底消除弹窗式内嵌卡片的留空与固定高度限制，完整铺发展现所有 Markdown 文档设置。
 */
export function MarkdownEditorSettingsPage(): React.ReactElement {
  const preferences = useAtomValue(markdownEditorPreferencesAtom)
  const preferencesError = useAtomValue(markdownEditorPreferencesErrorAtom)
  const saving = useAtomValue(markdownEditorPreferencesSavingAtom)
  const load = useSetAtom(loadMarkdownEditorPreferencesAtom)
  const update = useSetAtom(updateMarkdownEditorPreferencesAtom)
  const [validationError, setValidationError] = React.useState('')
  const error = validationError || (preferencesError ? '设置保存失败，请重试；文档草稿仍保留。' : '')

  React.useEffect(() => {
    void load().catch(() => {})
  }, [load])

  const save = (patch: Partial<MarkdownEditorPreferences>) => {
    setValidationError('')
    void update(patch).catch(() => {})
  }

  const handleShortcutChange = (key: keyof MarkdownEditorPreferences['shortcuts'], value: string) => {
    if (Object.entries(preferences.shortcuts).some(([k, accelerator]) => k !== key && accelerator === value)) {
      setValidationError('该快捷键已用于另一个文档操作，请选择其他键。')
      return
    }
    setValidationError('')
    save({ shortcuts: { ...preferences.shortcuts, [key]: value } })
  }

  const handleResetDefaults = () => {
    setValidationError('')
    save({
      ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
      shortcuts: { ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES.shortcuts },
    })
  }

  const themeStyle = markdownThemeStyle(preferences.theme)
  const activeThemePreset = preferences.theme === 'inherit' ? null : MARKDOWN_DOCUMENT_THEMES.find(t => t.id === preferences.theme)

  return (
    <div className="space-y-6" data-testid="markdown-editor-settings-page">
      {/* 顶部标题行与恢复默认按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">文档设置</h3>
          <p className="text-sm text-muted-foreground mt-1">
            自定义 Markdown 文档的主题外观、排版样式、编辑器行为与快捷键
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={handleResetDefaults}
        >
          <RotateCcw size={12} className="mr-1.5" />
          恢复文档默认设置
        </Button>
      </div>

      {/* 错误提示栏 */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/* 区块 1：主题与外观 */}
      <SettingsSection
        title="主题与外观"
        description="选择文档阅读与编辑时的配色方案，或跟随 Gamma 外观"
      >
        <SettingsCard>
          <SettingsToggle
            label="跟随 Gamma 外观"
            description="开启后文档配色自动使用应用当前的深浅主题与全局风格"
            checked={preferences.theme === 'inherit'}
            onCheckedChange={(checked) => save({ theme: checked ? 'inherit' : 'paper' })}
          />

          <div className="px-4 py-3 space-y-2.5">
            <div className="text-sm font-medium text-foreground">主题预设</div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {MARKDOWN_DOCUMENT_THEMES.map((item) => {
                const isSelected = preferences.theme === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`${item.label}主题`}
                    aria-pressed={isSelected}
                    onClick={() => save({ theme: item.id })}
                    className="group min-w-0 space-y-2 text-center text-xs focus-visible:outline-none"
                  >
                    <span
                      className={`flex h-16 items-center justify-center rounded-lg border text-xl font-semibold shadow-sm transition-all group-focus-visible:ring-2 group-focus-visible:ring-ring ${
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:scale-[1.02]'
                      }`}
                      style={{ backgroundColor: item.background, color: item.text, borderColor: item.border }}
                    >
                      Aa
                    </span>
                    <FadeTitle className="block truncate font-medium">{item.label}</FadeTitle>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 实时排版预览 */}
          <div className="px-4 py-4 space-y-2">
            <div className="text-sm font-medium text-foreground">排版效果实时预览</div>
            <div
              className="rounded-lg border border-border/60 p-5 transition-colors"
              style={activeThemePreset ? { backgroundColor: activeThemePreset.background, color: activeThemePreset.text, borderColor: activeThemePreset.border } : themeStyle}
            >
              <div style={markdownEditorStyle(preferences)}>
                <div
                  style={{
                    fontFamily: 'var(--md-editor-font)',
                    fontSize: 'var(--md-editor-size)',
                    lineHeight: 'var(--md-editor-line-height)',
                    letterSpacing: 'var(--md-editor-letter-spacing)',
                  }}
                >
                  <h4
                    className="text-base font-semibold mb-2"
                    style={{ textAlign: preferences.headingAlign }}
                  >
                    阅读与写作
                  </h4>
                  <p className="text-sm">
                    好的排版让你专注内容。Good typography stays quiet. 好的排版克制而优雅，让思考与表达自然流动。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 区块 2：排版与字体 */}
      <SettingsSection
        title="排版与字体"
        description="配置中英文正文字体族、字号大小、行距与版面宽度"
      >
        <SettingsCard>
          {editorChoices.map((choice) => (
            <SettingsRow
              key={choice.key}
              label={choice.label}
              description={choice.description}
            >
              <Select
                value={String(preferences[choice.key])}
                onValueChange={(val) =>
                  save({
                    [choice.key]:
                      typeof preferences[choice.key] === 'number'
                        ? Number(val)
                        : val,
                  })
                }
              >
                <SelectTrigger
                  aria-label={choice.label}
                  className="h-8 w-[160px] text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choice.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>

      {/* 区块 3：编辑器与 Markdown 行为 */}
      <SettingsSection
        title="编辑器与 Markdown"
        description="配置常用视图模式与编辑交互辅助功能"
      >
        <SettingsCard>
          {markdownChoices.map((choice) => (
            <SettingsRow
              key={choice.key}
              label={choice.label}
              description={choice.description}
            >
              <Select
                value={String(preferences[choice.key])}
                onValueChange={(val) => save({ [choice.key]: val })}
              >
                <SelectTrigger
                  aria-label={choice.label}
                  className="h-8 w-[160px] text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choice.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          ))}

          {editorToggles.map((toggle) => (
            <SettingsToggle
              key={toggle.key}
              label={toggle.label}
              description={toggle.description}
              checked={preferences[toggle.key]}
              onCheckedChange={(checked) => save({ [toggle.key]: checked })}
            />
          ))}

          <SettingsToggle
            label={tableToggle.label}
            description={tableToggle.description}
            checked={preferences[tableToggle.key]}
            onCheckedChange={(checked) => save({ [tableToggle.key]: checked })}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 区块 4：中文排版规范 */}
      <SettingsSection
        title="中文排版规范"
        description="优化中英文混排、标点符号与全角字符，提升阅读质感"
      >
        <SettingsCard>
          {cjkToggles.map((toggle) => (
            <SettingsToggle
              key={toggle.key}
              label={toggle.label}
              description={toggle.description}
              checked={preferences[toggle.key]}
              onCheckedChange={(checked) => save({ [toggle.key]: checked })}
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      {/* 区块 5：文档快捷键 */}
      <SettingsSection
        title="文档快捷键"
        description="自定义文档模式切换快捷键，并查看常用编辑操作按键"
      >
        <SettingsCard>
          {shortcutRows.map((item) => (
            <SettingsRow
              key={item.key}
              label={item.label}
              description={item.description}
            >
              <Select
                value={preferences.shortcuts[item.key]}
                onValueChange={(val) => handleShortcutChange(item.key, val)}
              >
                <SelectTrigger
                  aria-label={`${item.label}快捷键`}
                  className="h-8 w-[136px] text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {shortcutOptions.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          ))}
        </SettingsCard>

        {/* 常用快捷键速查表 */}
        <SettingsCard>
          <div className="px-4 py-3">
            <div className="text-sm font-medium text-foreground mb-1">常用编辑快捷键速查</div>
            <p className="text-xs text-muted-foreground mb-3">
              系统预置常用 Markdown 编辑与源码操作快捷键
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {staticShortcuts.map(([label, shortcut]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 border border-border/40"
                >
                  <span className="text-foreground">{label}</span>
                  <kbd className="font-mono text-xs text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/60">
                    {shortcut}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 底部保存状态提示 */}
      <div
        className="flex items-center justify-between text-xs text-muted-foreground pt-2 pb-6"
        role="status"
      >
        <span>{saving ? '保存设置中…' : '更改即时生效，自动保存'}</span>
      </div>
    </div>
  )
}

interface MarkdownEditorSettingsProps {
  mode?: 'page' | 'dialog'
}

export function MarkdownEditorSettings({ mode = 'dialog' }: MarkdownEditorSettingsProps = {}): React.ReactElement {
  if (mode === 'page') {
    return <MarkdownEditorSettingsPage />
  }

  const preferences = useAtomValue(markdownEditorPreferencesAtom)
  const preferencesError = useAtomValue(markdownEditorPreferencesErrorAtom)
  const saving = useAtomValue(markdownEditorPreferencesSavingAtom)
  const load = useSetAtom(loadMarkdownEditorPreferencesAtom)
  const update = useSetAtom(updateMarkdownEditorPreferencesAtom)
  const [category, setCategory] = React.useState<Category>('appearance')
  const [query, setQuery] = React.useState('')
  const [validationError, setValidationError] = React.useState('')
  const error = validationError || (preferencesError ? '设置保存失败，请重试；文档草稿仍保留。' : '')
  React.useEffect(() => { void load().catch(() => { /* 读取失败由共享错误状态显示。 */ }) }, [load])
  const save = (patch: Partial<MarkdownEditorPreferences>) => {
    setValidationError('')
    void update(patch).catch(() => { /* 保存失败由共享错误状态显示，后续成功会清除旧错误。 */ })
  }
  const term = query.trim().toLocaleLowerCase()
  const matches = (label: string, description = '') => !term || `${label} ${description}`.toLocaleLowerCase().includes(term)
  const show = (id: Category) => Boolean(term) || category === id
  const themeStyle = markdownThemeStyle(preferences.theme)
  const choice = (field: Choice) => matches(field.label, field.description) && <SettingRow key={field.key} label={field.label} description={field.description}><Select value={String(preferences[field.key])} onValueChange={value => save({ [field.key]: typeof preferences[field.key] === 'number' ? Number(value) : value })}><SelectTrigger aria-label={field.label} className="h-8 w-full min-w-[136px] text-xs"><SelectValue /></SelectTrigger><SelectContent style={themeStyle}>{field.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></SettingRow>
  const toggle = (field: Toggle) => matches(field.label, field.description) && <SettingRow key={field.key} label={field.label} description={field.description}><Switch aria-label={field.label} checked={preferences[field.key]} onCheckedChange={checked => save({ [field.key]: checked })} /></SettingRow>
  const shortcutRowsDialog: { key: keyof MarkdownEditorPreferences['shortcuts']; label: string }[] = [{ key: 'sourcePeek', label: '段落源码' }, { key: 'toggleSource', label: '切换源码视图' }, { key: 'toggleEdit', label: '锁定或解锁编辑' }]
  return <div className="markdown-editor-settings flex h-full min-h-0 bg-background text-foreground" style={themeStyle} data-testid="markdown-editor-settings">
    <aside className="markdown-settings-sidebar flex shrink-0 flex-col border-r border-border/60 bg-muted/30 p-3">
      <div className="relative mb-3"><Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" /><Input aria-label="搜索文档设置" placeholder="搜索设置…" value={query} onChange={event => setQuery(event.target.value)} className="h-9 pl-8 text-xs" /></div>
      <nav aria-label="文档设置分类" className="flex flex-col gap-1">{categories.map(item => <button key={item.id} type="button" aria-current={!term && category === item.id ? 'page' : undefined} onClick={() => { setCategory(item.id); setQuery('') }} className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!term && category === item.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}>{item.icon}<span>{item.label}</span></button>)}</nav>
      <Button variant="ghost" size="sm" className="mt-auto justify-start gap-2 text-xs" onClick={() => save({ ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, shortcuts: { ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES.shortcuts } })}><RotateCcw size={14} />恢复文档默认设置</Button>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5" role="region" aria-label="文档设置内容">
        {show('appearance') && matches('主题', '外观 白色 纸张 薄荷 棕褐色 夜间 Solarized 跟随 Gamma') && <section className="space-y-5"><h3 className="text-base font-semibold">主题</h3><div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{MARKDOWN_DOCUMENT_THEMES.map(item => <button key={item.id} type="button" aria-label={`${item.label}主题`} aria-pressed={preferences.theme === item.id} onClick={() => save({ theme: item.id })} className="group min-w-0 space-y-2 text-center text-xs focus-visible:outline-none"><span className={`flex h-16 items-center justify-center rounded-lg border text-xl font-semibold shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-ring ${preferences.theme === item.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`} style={{ backgroundColor: item.background, color: item.text }}>Aa</span><FadeTitle className="block truncate">{item.label}</FadeTitle></button>)}</div><SettingRow label="跟随 Gamma 外观" description="文档使用应用当前的深浅主题与配色。"><Switch aria-label="跟随 Gamma 外观" checked={preferences.theme === 'inherit'} onCheckedChange={checked => save({ theme: checked ? 'inherit' : 'paper' })} /></SettingRow><div className="rounded-lg border border-border/60 bg-background px-5 py-4" style={markdownEditorStyle(preferences)}><div style={{ fontFamily: 'var(--md-editor-font)', fontSize: 'var(--md-editor-size)', lineHeight: 'var(--md-editor-line-height)', letterSpacing: 'var(--md-editor-letter-spacing)' }}><strong className="font-semibold">阅读与写作</strong><p>好的排版让你专注内容。Good typography stays quiet.</p></div></div></section>}
        {show('editor') && <section><h3 className="mb-3 text-base font-semibold">排版与源码</h3>{editorChoices.map(choice)}{editorToggles.map(toggle)}</section>}
        {show('markdown') && <section><h3 className="mb-3 text-base font-semibold">Markdown</h3>{markdownChoices.map(choice)}{toggle(tableToggle)}</section>}
        {show('cjk') && <section><h3 className="mb-3 text-base font-semibold">中文排版</h3><p className="mb-3 text-xs leading-relaxed text-muted-foreground">在文档的更多菜单中选择「中文排版」，预览后应用；修改不会自动写盘，可撤销。</p>{cjkToggles.map(toggle)}</section>}
        {show('shortcuts') && <section><h3 className="mb-3 text-base font-semibold">快捷键</h3>{shortcutRowsDialog.map(item => matches(item.label, '快捷键') && <SettingRow key={item.key} label={item.label}><Select value={preferences.shortcuts[item.key]} onValueChange={value => { if (Object.entries(preferences.shortcuts).some(([key, accelerator]) => key !== item.key && accelerator === value)) { setValidationError('该快捷键已用于另一个文档操作，请选择其他键。'); return } save({ shortcuts: { ...preferences.shortcuts, [item.key]: value } }) }}><SelectTrigger aria-label={`${item.label}快捷键`} className="h-8 w-[136px] text-xs"><SelectValue /></SelectTrigger><SelectContent style={themeStyle}>{shortcutOptions.map(key => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent></Select></SettingRow>)}{staticShortcuts.map(([label, key]) => matches(label ?? '', '快捷键') && <SettingRow key={label} label={label ?? ''}><kbd className="text-xs text-muted-foreground">{key}</kbd></SettingRow>)}</section>}
        {term && ![...editorChoices, ...markdownChoices, ...editorToggles, ...cjkToggles, ...shortcutRowsDialog, tableToggle, { label: '主题 外观 白色 纸张 薄荷 棕褐色 夜间 Solarized 跟随 Gamma' }, { label: '保存 查找 粗体 斜体 撤销 应用段落源码 取消段落源码 快捷键' }].some(field => matches(field.label, 'description' in field ? field.description ?? '' : '')) && <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的设置</p>}
      </div>
      <div className="flex min-h-9 shrink-0 items-center border-t border-border/50 px-6 py-2 text-xs text-muted-foreground" role={error ? 'alert' : 'status'}>{error || (saving ? '保存设置中…' : '更改即时生效，自动保存')}</div>
    </div>
  </div>
}

export function MarkdownEditorSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const preferences = useAtomValue(markdownEditorPreferencesAtom)
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent style={markdownThemeStyle(preferences.theme)} className="flex h-[min(680px,85vh)] w-[calc(100vw-48px)] max-w-[900px] flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4"><DialogTitle className="text-center text-sm">文档设置</DialogTitle><DialogDescription className="sr-only">调整 Markdown 主题、排版、编辑器和快捷键，更改自动保存。</DialogDescription></DialogHeader><MarkdownEditorSettings /></DialogContent></Dialog>
}

