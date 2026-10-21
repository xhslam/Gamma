import { describe, expect, test } from 'bun:test'
import {
  buildGitAttributionPromptSection,
  GAMMA_COMMIT_TRAILER,
  GAMMA_GITHUB_URL,
  GAMMA_PR_ATTRIBUTION,
  isGitAttributionEnabled,
} from './agent-git-attribution'

describe('Gamma Git / PR 归因', () => {
  test('Given 默认启用归因 When 创建 commit 或 PR Then 仅使用 Gamma 名称与当前项目地址', () => {
    expect(isGitAttributionEnabled()).toBe(true)
    expect(GAMMA_COMMIT_TRAILER).toBe('Made-with: Gamma')
    expect(GAMMA_GITHUB_URL).toBe('https://github.com/xhslam/Gamma')
    expect(GAMMA_PR_ATTRIBUTION).toBe('Made with [Gamma](https://github.com/xhslam/Gamma)')

    const section = buildGitAttributionPromptSection(true)
    expect(section).toContain(GAMMA_COMMIT_TRAILER)
    expect(section).toContain(GAMMA_PR_ATTRIBUTION)
    expect(section.match(/https:\/\//g)).toHaveLength(1)
    expect(section).not.toMatch(/proma/i)
  })

  test('Given 用户明确关闭归因 When 构建 Agent 指令 Then 保留关闭决定且不注入项目链接或 trailer', () => {
    expect(isGitAttributionEnabled(false)).toBe(false)
    expect(isGitAttributionEnabled({ enabled: false })).toBe(false)

    const section = buildGitAttributionPromptSection(false)
    expect(section).toContain('用户已关闭 Gamma 标识')
    expect(section).not.toContain(GAMMA_GITHUB_URL)
    expect(section).not.toContain(GAMMA_COMMIT_TRAILER)
    expect(section).not.toMatch(/proma/i)
  })
})
