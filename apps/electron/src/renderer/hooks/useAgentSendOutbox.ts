import * as React from 'react'
import type { AgentSendOutboxEntry } from '@gamma/shared'

/** 会话切换与异步读取用 generation 隔离，旧会话的快照不能显示在新输入框。 */
export function useAgentSendOutbox(sessionId: string): {
  entries: AgentSendOutboxEntry[]
  error: string | null
  refresh: () => Promise<void>
} {
  const [state, setState] = React.useState<{ sessionId: string; entries: AgentSendOutboxEntry[]; error: string | null }>({ sessionId, entries: [], error: null })
  const request = React.useRef(0)
  const activeSession = React.useRef(sessionId)
  activeSession.current = sessionId
  const refresh = React.useCallback(async (): Promise<void> => {
    if (activeSession.current !== sessionId) return
    const generation = ++request.current
    try {
      const entries = await window.electronAPI.listAgentSendOutbox(sessionId)
      if (generation === request.current && activeSession.current === sessionId) setState({ sessionId, entries, error: null })
    } catch (error) {
      if (generation === request.current && activeSession.current === sessionId) setState((previous) => ({ sessionId, entries: previous.sessionId === sessionId ? previous.entries : [], error: String(error) }))
    }
  }, [sessionId])
  React.useEffect(() => {
    void refresh()
    const stopStream = window.electronAPI.onAgentStreamEvent((event) => {
      if (event.sessionId !== sessionId) return
      if ((event.payload.kind === 'sdk_message' && event.payload.message.type === 'user')
        || (event.payload.kind === 'gamma_event' && ['run_started', 'run_completed'].includes(event.payload.event.type))) void refresh()
    })
    const stopQueue = window.electronAPI.onAgentQueuedMessageStatus((event) => { if (event.sessionId === sessionId) void refresh() })
    const stopComplete = window.electronAPI.onAgentStreamComplete((event) => { if (event.sessionId === sessionId) void refresh() })
    return () => { ++request.current; stopStream(); stopQueue(); stopComplete() }
  }, [sessionId, refresh])
  return { entries: state.sessionId === sessionId ? state.entries : [], error: state.sessionId === sessionId ? state.error : null, refresh }
}
