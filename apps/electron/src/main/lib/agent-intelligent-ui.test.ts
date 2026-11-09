import { describe, expect, test } from 'bun:test'
import { buildIntelligentUiPromptSection } from './agent-intelligent-ui'

describe('Intelligent UI 模型引导', () => {
  test('Given 开启且前台会话 When 生成引导 Then 包含协议、实例和确认式回传边界', () => {
    const prompt = buildIntelligentUiPromptSection(true)!
    for (const value of ['dsh-ui', '"type":"table"', '"type":"submit"', '发送给 Agent', '不写 HTML/JS', '绝不索取密码']) expect(prompt).toContain(value)
  })
  test('Given 关闭或无人值守 When 生成引导 Then 不注入 UI 协议', () => {
    expect(buildIntelligentUiPromptSection(false)).toBeUndefined()
    expect(buildIntelligentUiPromptSection(true, false)).toBeUndefined()
  })
})
