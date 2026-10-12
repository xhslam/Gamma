import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES } from '@gamma/shared'
import type { MarkdownEditorPreferences } from '@gamma/shared'
import { writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'

interface SettingsScenarioResult {
  preferences: MarkdownEditorPreferences
  themeMode?: string
  sendWithCmdEnter?: boolean
  saved?: MarkdownEditorPreferences
  backup?: MarkdownEditorPreferences
  didThrow?: boolean
  unchanged?: boolean
}

/** 独立进程隔离路径 mock，测试只读写临时配置。 */
async function runSettingsScenario(settingsPath: string, scenario: string): Promise<SettingsScenarioResult> {
  const source = `
    import { mock } from 'bun:test'
    import { readFileSync } from 'node:fs'
    const settingsPath = ${JSON.stringify(settingsPath)}
    mock.module(${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))}, () => ({ getSettingsPath: () => settingsPath }))
    const { getSettings, updateSettings } = await import(${JSON.stringify(join(import.meta.dir, 'settings-service.ts'))})
    ${scenario}
  `
  const child = Bun.spawn([process.execPath, '--eval', source], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(`Markdown 设置测试失败: ${stderr}`)
  const resultLine = stdout.trim().split('\n').at(-1)
  if (!resultLine) throw new Error('Markdown 设置测试没有输出')
  return JSON.parse(resultLine) as SettingsScenarioResult
}

describe('Markdown 编辑器偏好持久化', () => {
  test('Given 缺失、旧版本或损坏配置 When 读取 Then 返回完整偏好且兼容旧 AI 字号', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-markdown-settings-'))
    const settingsPath = join(directory, 'settings.json')
    const scenario = `console.log(JSON.stringify({preferences:getSettings().markdownEditor}))`
    try {
      expect((await runSettingsScenario(settingsPath, scenario)).preferences).toEqual(DEFAULT_MARKDOWN_EDITOR_PREFERENCES)
      writeJsonFileAtomic(settingsPath, { themeMode: 'dark', markdownFontSize: 'small' })
      expect((await runSettingsScenario(settingsPath, scenario)).preferences).toEqual(DEFAULT_MARKDOWN_EDITOR_PREFERENCES)
      writeTextFileAtomic(settingsPath, '{错误 JSON')
      expect((await runSettingsScenario(settingsPath, scenario)).preferences).toEqual(DEFAULT_MARKDOWN_EDITOR_PREFERENCES)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('Given 主题、源码偏好和自定义键 When 局部更新 Then 深合并、原子写盘且保留应用设置', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-markdown-settings-'))
    const settingsPath = join(directory, 'settings.json')
    const initial: MarkdownEditorPreferences = { ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, theme: 'paper', fontSize: 20, sourceWordWrap: false, shortcuts: { sourcePeek: 'F2', toggleSource: 'F3', toggleEdit: 'F4' } }
    try {
      writeJsonFileAtomic(settingsPath, { themeMode: 'dark', sendWithCmdEnter: true, markdownEditor: initial })
      const result = await runSettingsScenario(settingsPath, `
        updateSettings({markdownEditor:{tabSize:4,shortcuts:{toggleEdit:'F12'}}})
        const restored=getSettings()
        console.log(JSON.stringify({preferences:restored.markdownEditor,themeMode:restored.themeMode,sendWithCmdEnter:restored.sendWithCmdEnter,saved:JSON.parse(readFileSync(settingsPath,'utf8')).markdownEditor,backup:JSON.parse(readFileSync(settingsPath+'.bak','utf8')).markdownEditor}))
      `)
      const expected: MarkdownEditorPreferences = { ...initial, tabSize: 4, shortcuts: { ...initial.shortcuts, toggleEdit: 'F12' } }
      expect(result).toEqual({ preferences: expected, themeMode: 'dark', sendWithCmdEnter: true, saved: expected, backup: initial })
      expect(existsSync(settingsPath + '.tmp')).toBe(false)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('Given 手写坏值和不可信更新 When 读取保存 Then 每个字段规范化且不持久化未知偏好', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-markdown-settings-'))
    const settingsPath = join(directory, 'settings.json')
    try {
      writeJsonFileAtomic(settingsPath, { markdownEditor: { theme: 'mint', fontSize: 100, shortcuts: { sourcePeek: 'x' }, tableFit: false } })
      const result = await runSettingsScenario(settingsPath, `
        updateSettings({markdownEditor:{fontSize:'bad',lineHeight:2,unknown:true,shortcuts:{toggleEdit:'F20'}}})
        console.log(JSON.stringify({preferences:getSettings().markdownEditor,saved:JSON.parse(readFileSync(settingsPath,'utf8')).markdownEditor}))
      `)
      const expected: MarkdownEditorPreferences = { ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, theme: 'mint', lineHeight: 2 }
      expect(result).toEqual({ preferences: expected, saved: expected })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('Given 原子写入临时路径不可写 When 更新偏好 Then 抛出错误并保持完整旧配置', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-markdown-settings-'))
    const settingsPath = join(directory, 'settings.json')
    try {
      writeJsonFileAtomic(settingsPath, { themeMode: 'dark', markdownEditor: DEFAULT_MARKDOWN_EDITOR_PREFERENCES })
      mkdirSync(settingsPath + '.tmp')
      const result = await runSettingsScenario(settingsPath, `
        const before=readFileSync(settingsPath,'utf8');let didThrow=false
        try{updateSettings({markdownEditor:{theme:'night'}})}catch{didThrow=true}
        console.log(JSON.stringify({preferences:getSettings().markdownEditor,didThrow,unchanged:readFileSync(settingsPath,'utf8')===before}))
      `)
      expect(result).toEqual({ preferences: DEFAULT_MARKDOWN_EDITOR_PREFERENCES, didThrow: true, unchanged: true })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
