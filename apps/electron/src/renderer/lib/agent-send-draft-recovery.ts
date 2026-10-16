/** 草稿包括 Markdown、结构化 HTML 和每次真实编辑的版本，防止 a→b→a 或清空后又输入被覆盖。 */
export interface AgentDraftCheckpoint {
  text: string
  html: string
  editVersion: number
  syncVersion: number
}

export function isAgentDraftUnchanged(expected: AgentDraftCheckpoint, current: AgentDraftCheckpoint): boolean {
  return expected.text === current.text && expected.html === current.html
    && expected.editVersion === current.editVersion && expected.syncVersion === current.syncVersion
}

/** 同一会话的一次提交覆盖附件准备和 IPC；其他会话仍可独立提交。 */
export function createAgentSendGuard(): {
  isPending: (sessionId: string) => boolean
  begin: (sessionId: string) => symbol | null
  finish: (sessionId: string, requestId: symbol) => void
} {
  const pending = new Map<string, symbol>()
  return {
    isPending: (sessionId) => pending.has(sessionId),
    begin(sessionId) {
      if (pending.has(sessionId)) return null
      const requestId = Symbol(sessionId)
      pending.set(sessionId, requestId)
      return requestId
    },
    finish(sessionId, requestId) {
      if (pending.get(sessionId) === requestId) pending.delete(sessionId)
    },
  }
}

interface AgentSendRecoveryState {
  guard: ReturnType<typeof createAgentSendGuard>
  draftEditVersions: Map<string, number>
  /** 恢复草稿再次提交时复用稳定 ID，避免旧失败项与重发项同时存在。 */
  restoredOutboxIds: Map<string, string>
  restoredOutboxDrafts: Map<string, AgentDraftCheckpoint>
  clearableOutboxDraftIds: Map<string, string>
  restoredOutboxContexts: Map<string, string>
}

// 同一 Jotai store 中的多个 AgentView（或切换后重挂载）共享锁与编辑版本。
// WeakMap 不跨工作区 store 保留草稿，也不会让已销毁的 store 常驻。
const recoveryStates = new WeakMap<object, AgentSendRecoveryState>()
export function getAgentSendRecoveryState(scope: object): AgentSendRecoveryState {
  let state = recoveryStates.get(scope)
  if (!state) {
    state = { guard: createAgentSendGuard(), draftEditVersions: new Map(), restoredOutboxIds: new Map(), restoredOutboxDrafts: new Map(), clearableOutboxDraftIds: new Map(), restoredOutboxContexts: new Map() }
    recoveryStates.set(scope, state)
  }
  return state
}
