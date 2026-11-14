export interface WorkspaceOwnedTerminalSession {
  workspaceInstanceId?: string | null
}

export function isTerminalSessionInWorkspace(
  session: WorkspaceOwnedTerminalSession,
  workspaceInstanceId: string | null,
): boolean {
  return session.workspaceInstanceId
    ? session.workspaceInstanceId === workspaceInstanceId
    : true
}

export function selectTerminalSessionsForWorkspace<
  Session extends WorkspaceOwnedTerminalSession,
>(sessions: Session[], workspaceInstanceId: string | null): Session[] {
  return sessions.filter((session) =>
    isTerminalSessionInWorkspace(session, workspaceInstanceId),
  )
}

export function selectActiveTerminalSessionId<
  Session extends WorkspaceOwnedTerminalSession & { id: string },
>(
  sessions: Session[],
  workspaceInstanceId: string | null,
  currentSessionId: string | null,
  preferredSessionId: string | null,
): string | null {
  const visibleSessions = selectTerminalSessionsForWorkspace(
    sessions,
    workspaceInstanceId,
  )
  const visibleIds = new Set(visibleSessions.map(({ id }) => id))

  if (currentSessionId && visibleIds.has(currentSessionId)) {
    return currentSessionId
  }
  if (preferredSessionId && visibleIds.has(preferredSessionId)) {
    return preferredSessionId
  }
  return visibleSessions.at(-1)?.id ?? null
}
