export type StopGenerationTarget =
  | { kind: 'agent'; sessionId: string }
  | { kind: 'agy'; sessionId: string; taskId: string }

interface SessionTabLike {
  type: string
  sessionId: string
}

let lastInteractedStopTarget: StopGenerationTarget | null = null

/** 记录最近获得焦点或点击的 Agent 视图。 */
export function rememberStopGenerationTarget(target: StopGenerationTarget): void {
  lastInteractedStopTarget = target
}

/** 返回当前输入光标或最近点击所在的 Agent 视图。 */
export function getLastInteractedStopTarget(): StopGenerationTarget | null {
  return lastInteractedStopTarget
}

/** Clears the stored target only when the owning view unmounts. */
export function clearStopGenerationTarget(target: StopGenerationTarget): void {
  if (
    lastInteractedStopTarget?.kind === target.kind
    && lastInteractedStopTarget.sessionId === target.sessionId
    && (target.kind !== 'agy' || (lastInteractedStopTarget.kind === 'agy' && lastInteractedStopTarget.taskId === target.taskId))
  ) {
    lastInteractedStopTarget = null
  }
}

interface DelegationSelectionLike {
  type: string
  sessionId: string
}

/**
 * Resolves a fallback target when the user has not yet focused or clicked a
 * conversation view in this window.
 */
export function resolveStopGenerationTarget(
  activeTab: SessionTabLike | null,
  activeAgentSidePanelTab: string | undefined,
  activeDelegation: DelegationSelectionLike | null = null,
): StopGenerationTarget | null {
  if (!activeTab) return null

  if (activeTab.type === 'agent' || activeTab.type === 'preview') {
    if (activeAgentSidePanelTab?.startsWith('agy:') && activeAgentSidePanelTab.length > 4) {
      return { kind: 'agy', sessionId: activeTab.sessionId, taskId: activeAgentSidePanelTab.slice(4) }
    }
    const delegatedChildSessionId = activeAgentSidePanelTab === 'delegation'
      && activeDelegation?.type === 'agent'
      ? activeDelegation.sessionId
      : null

    return {
      kind: 'agent',
      sessionId: delegatedChildSessionId || activeTab.sessionId,
    }
  }

  return null
}

/** Reads and validates a target attached to the global stop shortcut event. */
export function getStopGenerationTarget(event: Event): StopGenerationTarget | null {
  const detail = (event as CustomEvent<unknown>).detail
  if (!detail || typeof detail !== 'object') return null

  const candidate = detail as Partial<StopGenerationTarget>
  if (
    (candidate.kind !== 'agent' && candidate.kind !== 'agy')
    || typeof candidate.sessionId !== 'string'
    || candidate.sessionId.length === 0
  ) {
    return null
  }

  if (candidate.kind === 'agy' && (typeof candidate.taskId !== 'string' || !candidate.taskId)) return null
  return candidate as StopGenerationTarget
}
