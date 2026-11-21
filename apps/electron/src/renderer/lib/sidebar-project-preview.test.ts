import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@gamma/shared'
import type { AgentSessionTreeItem } from './collapsed-agent-rail'
import { getProjectPreviewSessions, SIDEBAR_PROJECT_PREVIEW_LIMIT } from './sidebar-project-preview'

function createTree(id: string, children: AgentSessionMeta[] = []): AgentSessionTreeItem {
  const session: AgentSessionMeta = {
    id,
    title: `会话 ${id}`,
    workspaceId: 'project',
    createdAt: 1,
    updatedAt: 1,
  }
  return { session, childSessions: children }
}

describe('Given 项目会话预览', () => {
  const sessions = Array.from({ length: 12 }, (_, index) => createTree(`session-${index}`))

  test('When 会话不超过七条 Then 全部显示且保持原顺序', () => {
    const shortList = sessions.slice(0, SIDEBAR_PROJECT_PREVIEW_LIMIT)
    expect(getProjectPreviewSessions(shortList, 'session-6', false)).toEqual(shortList)
    expect(getProjectPreviewSessions([], null, false)).toEqual([])
  })

  test('When 长列表收起 Then 只显示七条，展开后恢复完整列表', () => {
    const preview = getProjectPreviewSessions(sessions, null, false)
    expect(preview).toHaveLength(7)
    expect(preview.map((item) => item.session.id)).toEqual(sessions.slice(0, 7).map((item) => item.session.id))
    expect(getProjectPreviewSessions(sessions, null, true)).toEqual(sessions)
  })

  test('When 当前会话位于预览之外 Then 仍保留当前会话且不重复', () => {
    const preview = getProjectPreviewSessions(sessions, 'session-11', false)
    expect(preview).toHaveLength(7)
    expect(preview.at(-1)?.session.id).toBe('session-11')
    expect(new Set(preview.map((item) => item.session.id)).size).toBe(7)
  })

  test('When 当前选中委派子会话 Then 保留其父会话所在行', () => {
    const child = { ...createTree('child').session, parentSessionId: 'session-10' }
    const withChild = sessions.map((item, index) => index === 10 ? createTree(item.session.id, [child]) : item)
    expect(getProjectPreviewSessions(withChild, 'child', false).at(-1)?.session.id).toBe('session-10')
  })
})
