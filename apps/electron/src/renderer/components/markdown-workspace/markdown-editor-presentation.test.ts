import { describe, expect, test } from 'bun:test'
import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES } from '@gamma/shared'
import { markdownEditorStyle, markdownShortcutMatches, markdownThemeStyle } from './markdown-editor-presentation'

describe('Given 文档排版与独立主题', () => {
  test('When 用户选择字号、字体和宽度 Then 仅输出文档容器的令牌', () => {
    const style = markdownEditorStyle({ ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, fontSize: 22, cjkFont: 'kai', contentWidth: 36 })
    expect(style['--md-editor-size']).toBe('22px')
    expect(style['--md-editor-font']).toContain('Kaiti SC')
    expect(style['--md-editor-width']).toBe('36em')
    expect(markdownEditorStyle({ ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, contentWidth: 0 })['--md-editor-width']).toBe('100%')
  })
  test('When 选择纸张或夜间主题 Then 使用对应的主题令牌且跟随模式不覆盖应用', () => {
    expect(markdownThemeStyle('paper').colorScheme).toBe('light')
    expect(markdownThemeStyle('night').colorScheme).toBe('dark')
    expect(markdownThemeStyle('inherit')).toEqual({})
    expect(markdownThemeStyle('mint')['--foreground']).not.toBe(markdownThemeStyle('mint')['--background'])
  })
  test('When 快捷键带有额外修饰键 Then 不误触发文档模式操作', () => {
    const event = { key: 'F7', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
    expect(markdownShortcutMatches(event, 'F7')).toBe(true)
    expect(markdownShortcutMatches({ ...event, key: 'F6' }, 'F7')).toBe(false)
    expect(markdownShortcutMatches({ ...event, metaKey: true }, 'F7')).toBe(false)
    expect(markdownShortcutMatches({ ...event, shiftKey: true }, 'F7')).toBe(false)
  })
})
