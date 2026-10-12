import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore, Provider } from 'jotai'
import { MarkdownEditorSettingsPage } from './MarkdownEditorSettings'
import { markdownEditorPreferencesAtom } from '@/atoms/markdown-editor-preferences'
import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES } from '@gamma/shared'

describe('MarkdownEditorSettingsPage 全量文档设置页', () => {
  test('Given 默认偏好 When 渲染全量文档设置页 Then 平铺展示所有配置区块且无固定高度弹窗卡片包裹', () => {
    const store = createStore()
    store.set(markdownEditorPreferencesAtom, DEFAULT_MARKDOWN_EDITOR_PREFERENCES)

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <MarkdownEditorSettingsPage />
      </Provider>,
    )

    // 验证根容器与标题
    expect(html).toContain('data-testid="markdown-editor-settings-page"')
    expect(html).toContain('文档设置')
    expect(html).toContain('恢复文档默认设置')

    // 验证主要设置区块
    expect(html).toContain('主题与外观')
    expect(html).toContain('跟随 Gamma 外观')
    expect(html).toContain('排版效果实时预览')
    expect(html).toContain('排版与字体')
    expect(html).toContain('编辑器与 Markdown')
    expect(html).toContain('中文排版规范')
    expect(html).toContain('文档快捷键')

    // 验证六大预设主题与快捷键速查
    expect(html).toContain('白色主题')
    expect(html).toContain('纸张主题')
    expect(html).toContain('薄荷主题')
    expect(html).toContain('棕褐色主题')
    expect(html).toContain('夜间主题')
    expect(html).toContain('Solarized主题')
    expect(html).toContain('常用编辑快捷键速查')

    // 验证不再有旧弹窗卡片中孤立的内层定高与留空约束
    expect(html).not.toContain('h-[min(680px')
  })

  test('Given 主题预设选择 When 渲染排版效果实时预览 Then 呈现样张正文与字体样式', () => {
    const store = createStore()
    store.set(markdownEditorPreferencesAtom, {
      ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
      theme: 'mint',
      fontSize: 20,
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <MarkdownEditorSettingsPage />
      </Provider>,
    )

    expect(html).toContain('阅读与写作')
    expect(html).toContain('Good typography stays quiet')
    expect(html).toContain('好的排版让你专注内容')
  })
})
