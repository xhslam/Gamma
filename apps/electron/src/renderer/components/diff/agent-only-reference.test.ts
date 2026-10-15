import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

// 架构回归：确保预览引用和右侧辅助区不会重新建立退役的 Chat 运行链。
// 实际会话恢复、输入引用与流式执行另由各自功能测试覆盖。
const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('Agent-only 预览引用和右侧辅助区', () => {
  it('Given 文件预览选区 When 用户引用 Then 仅插入 Agent 输入引用并聚焦，不创建或发送 Chat', () => {
    const preview = source('./DiffTabContent.tsx')
    expect(preview).toContain('insertAgentInputQuote(sessionId, quote)')
    expect(preview).toContain('focusAgentSessionInput(sessionId)')
    expect(preview).toContain('onAddToAgent={handleAddSelectionToAgent}')
    for (const retired of ['getOrCreateSideChat', 'createConversation(', 'focusChatInput', 'onOpenChat=', 'conversationQuotedSelectionMapAtom']) {
      expect(preview).not.toContain(retired)
    }
  })

  it('Given Agent 右侧工作区 When 渲染和停止生成 Then 不依赖 Chat 页面或状态', () => {
    const panel = source('../agent/SidePanel.tsx')
    for (const retired of ['ChatView', 'agentSideChatMapAtom', 'sideChatConversationId', "kind: 'chat'", "paneTab === 'chat'"]) {
      expect(panel).not.toContain(retired)
    }
    expect(panel).toContain('rememberStopGenerationTarget({ kind: \'agent\', sessionId })')
    expect(panel).toContain('agentPendingFilesAtomFamily')
  })

  it('Given 右侧新增页菜单 When 打开 Then 没有退役的 Chat 问答入口', () => {
    const menu = source('./DiffPanelTabBar.tsx')
    expect(menu).not.toContain('onOpenChat')
    expect(menu).not.toContain('打开问答')
    expect(menu).toContain('打开项目记忆')
    expect(menu).toContain('打开 Skills')
    expect(menu).toContain('打开 MCP')
  })
})
