import { describe, expect, test } from 'bun:test'
import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES, isMarkdownEditorShortcut, mergeMarkdownEditorPreferences, normalizeMarkdownEditorPreferences } from './markdown-workspace'
import type { MarkdownEditorPreferences } from './markdown-workspace'

describe('Markdown 编辑器偏好合同', () => {
  test('Given 新默认正文排版 When 初始化和往返读取 Then 保留15.5px字号与1.7行高，既有自定义选项不丢失', () => {
    expect(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontSize).toBe(15.5)
    expect(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.lineHeight).toBe(1.7)
    expect(normalizeMarkdownEditorPreferences({ fontSize: 15.5, lineHeight: 1.7 })).toEqual(DEFAULT_MARKDOWN_EDITOR_PREFERENCES)
    expect(mergeMarkdownEditorPreferences({ fontSize: 24, lineHeight: 2, latinFont: 'sans' }, { theme: 'night' })).toMatchObject({ fontSize: 24, lineHeight: 2, latinFont: 'sans', theme: 'night' })
  })
  test('Given 旧配置、数组或空值 When 规范化 Then 完整默认值且每次快捷键对象独立', () => {
    for (const value of [undefined, null, [], 'legacy', 18]) {
      expect(normalizeMarkdownEditorPreferences(value)).toEqual(DEFAULT_MARKDOWN_EDITOR_PREFERENCES)
    }
    const first = normalizeMarkdownEditorPreferences(undefined)
    first.shortcuts.sourcePeek = 'F2'
    expect(normalizeMarkdownEditorPreferences(undefined).shortcuts.sourcePeek).toBe('F5')
  })

  test('Given 有效外观与源码设置 When 规范化 Then 保留完整选择和明确 false', () => {
    const preferences: MarkdownEditorPreferences = {
      ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, theme: 'night', fontSize: 24, contentWidth: 0,
      sourceLineNumbers: false, sourceWordWrap: false, cjkSpacing: false, tabSize: 4,
      shortcuts: { sourcePeek: 'F1', toggleSource: 'F12', toggleEdit: 'F11' },
    }
    expect(normalizeMarkdownEditorPreferences(preferences)).toEqual(preferences)
  })

  test('Given 损坏或未知字段 When 读取 Then 仅坏字段回退、未知字段不进入运行时', () => {
    expect(normalizeMarkdownEditorPreferences({
      theme: 'paper', fontSize: 500, lineHeight: '1.8', contentWidth: -1, sourceWordWrap: 'false',
      tabSize: 3, headingAlign: 'right', unknown: true, shortcuts: { sourcePeek: 'p', toggleSource: 'F13' },
    })).toEqual({ ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, theme: 'paper' })
  })

  test('Given 已保存主题和快捷键 When 局部更新单个设置与快捷键 Then 保留其他偏好', () => {
    const current: MarkdownEditorPreferences = { ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, theme: 'sepia', shortcuts: { sourcePeek: 'F2', toggleSource: 'F3', toggleEdit: 'F4' } }
    expect(mergeMarkdownEditorPreferences(current, { fontSize: 20, shortcuts: { toggleEdit: 'F12' } })).toEqual({
      ...current, fontSize: 20, shortcuts: { ...current.shortcuts, toggleEdit: 'F12' },
    })
    expect(mergeMarkdownEditorPreferences(current, null)).toEqual(current)
  })

  test('Given 快捷键输入 When 校验 Then 接受 F 键并拒绝原生文本组合键与未支持 F 键', () => {
    for (const key of ['F1', 'F12', 'F5', 'F6']) expect(isMarkdownEditorShortcut(key)).toBe(true)
    for (const key of ['F0', 'F13', 'p', 'Mod+Shift+p', 'Ctrl+Alt+ArrowLeft', '', null]) expect(isMarkdownEditorShortcut(key)).toBe(false)
  })

  test('Given 手写大小写或重复快捷键 When 规范化 Then 使用统一键名且重复组合回退默认', () => {
    expect(normalizeMarkdownEditorPreferences({ shortcuts: { sourcePeek: 'f2' } }).shortcuts.sourcePeek).toBe('F2')
    expect(normalizeMarkdownEditorPreferences({ shortcuts: { sourcePeek: 'F6', toggleSource: 'f6', toggleEdit: 'F10' } }).shortcuts).toEqual(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.shortcuts)
  })
})
