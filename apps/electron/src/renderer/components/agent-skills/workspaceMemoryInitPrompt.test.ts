import { describe, expect, test } from 'bun:test'
import { buildWorkspaceKnowledgeBootstrapPrompt, PROJECT_KNOWLEDGE_MAINTENANCE_BLOCK } from './workspaceMemoryInitPrompt'

describe('知识维护受管协议改名兼容', () => {
  test('Given 项目保留旧受管区块 When 启动知识维护 Then 明确复用原标记且禁止重复追加', () => {
    const prompt = buildWorkspaceKnowledgeBootstrapPrompt()
    expect(prompt).toContain('<!-- proma:knowledge-maintenance:start -->')
    expect(prompt).toContain('<!-- gamma:knowledge-maintenance:start -->')
    expect(prompt).toContain('已有任一种时只做最小修订并保留原标记')
    expect(prompt).toContain('不因改名追加第二个区块')
  })

  test('Given 项目尚未建立受管协议 When 首次创建 Then 使用完整的新品牌区块', () => {
    expect(PROJECT_KNOWLEDGE_MAINTENANCE_BLOCK).toStartWith('<!-- gamma:knowledge-maintenance:start -->')
    expect(PROJECT_KNOWLEDGE_MAINTENANCE_BLOCK).toEndWith('<!-- gamma:knowledge-maintenance:end -->')
    expect(buildWorkspaceKnowledgeBootstrapPrompt()).toContain('两种均不存在时，追加下方完整区块')
  })
})
