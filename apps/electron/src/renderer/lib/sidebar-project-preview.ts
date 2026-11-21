import type { AgentSessionTreeItem } from './collapsed-agent-rail'

export const SIDEBAR_PROJECT_PREVIEW_LIMIT = 7

export function getProjectPreviewSessions(
  sessions: AgentSessionTreeItem[],
  activeSessionId: string | null,
  expanded: boolean,
): AgentSessionTreeItem[] {
  if (expanded || sessions.length <= SIDEBAR_PROJECT_PREVIEW_LIMIT) return sessions
  const preview = sessions.slice(0, SIDEBAR_PROJECT_PREVIEW_LIMIT)
  const containsSession = (item: AgentSessionTreeItem): boolean => (
    item.session.id === activeSessionId
    || item.childSessions.some((child) => child.id === activeSessionId)
  )
  const activeItem = sessions.find(containsSession)
  if (activeItem && !preview.some((item) => item.session.id === activeItem.session.id)) {
    preview[SIDEBAR_PROJECT_PREVIEW_LIMIT - 1] = activeItem
  }
  return preview
}
