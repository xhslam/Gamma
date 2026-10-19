import { describe, expect, test } from 'bun:test'
import { getToolPhrase, getToolResultSummary } from './tool-phrase'

describe('长期记忆工具展示状态 (tool-phrase)', () => {
  test('When 工具调用成功 Then 显示"已记住"', () => {
    const phrase = getToolPhrase('memory_write', { path: 'profile.md' }, false)
    expect(phrase.label).toBe('已记住')
    expect(phrase.loadingLabel).toBe('正在记住...')

    const summary = getToolResultSummary('memory_write', 'saved. [version: 123]', false)
    expect(summary).toBe('已记住')
  })

  test('When 工具调用失败（如版本冲突） Then 界面显示失败状态，不显示"已记住"', () => {
    const phraseWrite = getToolPhrase('memory_write', { path: 'profile.md' }, true)
    expect(phraseWrite.label).not.toBe('已记住')
    expect(phraseWrite.label).toBe('记忆更新失败')

    const phraseAppend = getToolPhrase('memory_append', { path: 'profile.md' }, true)
    expect(phraseAppend.label).not.toBe('已记住')
    expect(phraseAppend.label).toBe('记忆更新失败')

    const phraseStrReplace = getToolPhrase('memory_str_replace', { path: 'profile.md' }, true)
    expect(phraseStrReplace.label).not.toBe('已记住')
    expect(phraseStrReplace.label).toBe('记忆更新失败')

    const summary = getToolResultSummary('memory_write', 'version conflict', true)
    expect(summary).toBe('失败')
  })

  test('When computer 工具调用并执行动作 Then 格式化为正在操作 XX：意图', () => {
    const phrase = getToolPhrase('computer', { action: 'open_app', app: '备忘录' }, false)
    expect(phrase.label).toBe('操作 备忘录：打开应用 备忘录')
    expect(phrase.loadingLabel).toBe('正在操作 备忘录：打开应用 备忘录...')

    const clickPhrase = getToolPhrase('computer', { action: 'click', coordinate: [100, 200], appName: 'Safari', _intent: '打开网页' }, false)
    expect(clickPhrase.label).toBe('操作 Safari：打开网页')
    expect(clickPhrase.loadingLabel).toBe('正在操作 Safari：打开网页...')

    const successSummary = getToolResultSummary('computer', JSON.stringify({ message: '动作已投递' }), false)
    expect(successSummary).toBe('已投递，待验证')

    expect(getToolResultSummary('computer', JSON.stringify({ observationId: 'new', message: '观察已捕获' }), false)).toBe('已返回新观察')
    expect(getToolResultSummary('computer', JSON.stringify({ observationStability: 'timeout', message: '动作已投递' }), false)).toBe('已投递，界面待稳定')
    for (const [action, intent] of [['get_app_state', '观察应用状态'], ['set_value', '替换控件文本'], ['select_text', '选择文本或定位光标'], ['paste', '粘贴文本并保护剪贴板']]) {
      expect(getToolPhrase('computer', { action, app: 'Notes' }).label).toBe(`操作 Notes：${intent}`)
    }

    const interruptedSummary = getToolResultSummary('computer', JSON.stringify({ interrupted: true, reason: '检测到用户接管' }), false)
    expect(interruptedSummary).toContain('已中断')
    expect(interruptedSummary).toContain('检测到用户接管')
  })
})
