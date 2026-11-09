import { describe, expect, test } from 'bun:test'
import { appendDesignDraft, buildDesignPrompt, DESIGN_KINDS } from './design-prompt'

describe('Given design 简报', () => {
  test('When 生成设计需求 Then 引用确切本地 Skill，并约束本地画布与分享边界', () => {
    for (const kind of DESIGN_KINDS) {
      const prompt = buildDesignPrompt({ title: '阅读应用', request: '使用蓝色，支持窄屏', kind: kind.id }, '/local/skills/claude-design')
      expect(prompt).toContain('/local/skills/claude-design/SKILL.md')
      expect(prompt).toContain(kind.label)
      expect(prompt).toContain('project/canvas.json')
      expect(prompt).toContain('127.0.0.1')
      expect(prompt).toContain('不启用 --lan')
      expect(prompt).toContain('受管浏览器')
    }
  })
  test('When 输入为空或 Skill 未安装 Then 不能准备设计需求', () => {
    expect(() => buildDesignPrompt({ title: '', request: '需求', kind: 'interface' }, '/local')).toThrow('设计名称')
    expect(() => buildDesignPrompt({ title: '标题', request: '', kind: 'interface' }, '/local')).toThrow('设计名称')
    expect(() => buildDesignPrompt({ title: '标题', request: '需求', kind: 'interface' }, '')).toThrow('安装')
  })
  test('When 当前会话已有草稿 Then 追加设计需求而不覆盖原稿', () => {
    expect(appendDesignDraft('已有草稿', '新的设计需求')).toBe('已有草稿\n\n新的设计需求')
    expect(appendDesignDraft('', '新的设计需求')).toBe('新的设计需求')
  })
})
