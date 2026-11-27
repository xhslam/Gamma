import type { AgentStreamEvent } from '@carpus/shared'

/** 当前 run 的未落盘投影。完整 assistant 消息取代同 UUID 的增量。 */
export class AgentStreamReplay {
  private readonly events = new Map<string, AgentStreamEvent[]>()

  record(event: AgentStreamEvent): void {
    const { sessionId, payload } = event
    if (payload.kind === 'carpus_event' && ![
      'run_started', 'permission_request', 'permission_resolved', 'permission_mode_changed',
      'ask_user_request', 'ask_user_resolved', 'exit_plan_mode_request', 'exit_plan_mode_resolved',
      'enter_plan_mode', 'plan_mode_changed',
    ].includes(payload.event.type)) return
    let events = this.events.get(sessionId) ?? []
    if (payload.kind === 'sdk_message') {
      const message = payload.message as unknown as { type: string; uuid?: string; _partial?: boolean; isReplay?: boolean }
      if (message.isReplay) return
      if (message.type === 'assistant' && message.uuid && !message._partial) {
        events = events.filter(({ payload: previous }) => previous.kind !== 'sdk_delta' || previous.delta.uuid !== message.uuid)
      }
    }
    events.push(event)
    this.events.set(sessionId, events)
  }

  read(sessionId: string): AgentStreamEvent[] {
    return this.events.get(sessionId)?.slice() ?? []
  }

  clear(sessionId: string): void {
    this.events.delete(sessionId)
  }
}
