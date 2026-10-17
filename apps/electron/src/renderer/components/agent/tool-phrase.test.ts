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
})
