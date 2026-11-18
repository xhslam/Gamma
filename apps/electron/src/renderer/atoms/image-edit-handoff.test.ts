import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentSessionDraftHtmlAtom, agentSessionDraftSyncVersionsAtom, agentSessionDraftsAtom } from './agent-atoms'
import { appendImageEditPromptAtom } from './image-edit-handoff'

describe('Given 当前会话已有图片编辑草稿', () => {
  test('When 追加位置评论 Then 保留原文字并同步 Markdown、HTML 和版本号', () => {
    const store = createStore()
    store.set(agentSessionDraftsAtom, new Map([['session-a', '先保留原图风格']]))
    store.set(agentSessionDraftHtmlAtom, new Map([['session-a', '<p>先保留原图风格</p>']]))

    store.set(appendImageEditPromptAtom, { sessionId: 'session-a', prompt: '1. (x: 20%, y: 30%) 增加标记' })

    expect(store.get(agentSessionDraftsAtom).get('session-a')).toBe('先保留原图风格\n\n1. (x: 20%, y: 30%) 增加标记')
    expect(store.get(agentSessionDraftHtmlAtom).get('session-a')).toContain('先保留原图风格')
    expect(store.get(agentSessionDraftHtmlAtom).get('session-a')).toContain('增加标记')
    expect(store.get(agentSessionDraftSyncVersionsAtom).get('session-a')).toBe(1)
  })

  test('When 会话或评论为空 Then 不产生空草稿和同步', () => {
    const store = createStore()
    store.set(appendImageEditPromptAtom, { sessionId: '', prompt: '无效会话' })
    store.set(appendImageEditPromptAtom, { sessionId: 'session-b', prompt: '   ' })
    expect(store.get(agentSessionDraftsAtom).size).toBe(0)
    expect(store.get(agentSessionDraftHtmlAtom).size).toBe(0)
    expect(store.get(agentSessionDraftSyncVersionsAtom).size).toBe(0)
  })
})
