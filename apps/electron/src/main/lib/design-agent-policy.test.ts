import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { DesignArtifact } from '@gamma/shared'
import { buildDesignAgentContextPrompt } from './design-agent-policy'

const artifact: DesignArtifact = { id: 'artifact', workspaceId: 'workspace', sessionId: 'chat', title: '阅读首页', kind: 'canvas', rootPath: '/authorized/designs/reading', createdAt: 1, updatedAt: 1 }

describe('Given 绑定到聊天会话的 design 工作台', () => {
  test('When 构建上下文 Then 锁定已登记作品与 Skill，不要求新 API 或 Agent runtime', () => {
    const prompt = buildDesignAgentContextPrompt(artifact, '/bundle/skills/claude-design')
    expect(prompt).toContain('"root":"/authorized/designs/reading"')
    expect(prompt).toContain('/bundle/skills/claude-design/SKILL.md')
    expect(prompt).toContain('不要求另填 API Key')
    expect(prompt).toContain('不切到 Claude Code')
    expect(prompt).toContain('不要再次启动')
    expect(prompt).toContain('comment-reply')
    expect(prompt).toContain('禁止自动启用 LAN/share')
  })
  test('When 主 Agent 发送新一轮设计需求 Then 从主进程注入上下文，认证仍在既有编排层处理', () => {
    const source = readFileSync(new URL('./agent-orchestrator.ts', import.meta.url), 'utf8')
    expect(source).toContain('const designContext = await getDesignAgentContext(sessionId)')
    expect(source).toContain("+ (designContext?.prompt ?? '')")
    expect(source).toContain('apiKey,')
    const view = readFileSync(new URL('../../renderer/components/design/DesignWorkspaceView.tsx', import.meta.url), 'utf8')
    expect(view).toContain('const sessionId = source?.id ?? await createAgent')
    expect(view).toContain('<AgentView sessionId={entry.session.id} embedded />')
    expect(view).not.toContain('fillCurrentAgentPrompt')
  })
})
