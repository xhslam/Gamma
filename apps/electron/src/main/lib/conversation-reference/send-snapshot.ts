import type { AgentContextRef } from '@gamma/shared'
import { getAgentContextRefs, getAgentSessionSDKMessages } from '../agent-session-manager'

/** 只接受 Main 当前已授权的 refId；不信任 renderer 传来的源路径、标题或快照描述。 */
export function captureReferenceSnapshot(sessionId: string, ids?: string[]): AgentContextRef[] {
  const refs = getAgentContextRefs(sessionId)
  if (ids === undefined) return structuredClone(refs)
  if (!Array.isArray(ids) || ids.length > 5 || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('发送引用 ID 无效')
  return ids.map((id) => {
    const ref = refs.find((item) => item.refId === id)
    if (!ref || ref.sourceConversationId === sessionId) throw new Error('发送引用未获授权，请重新确认引用')
    return structuredClone(ref)
  })
}

/** 重试使用当时用户消息的快照；旧历史没有引用字段时明确为空。 */
export function getRetryReferenceSnapshot(sessionId: string, userUuid?: string, errorUuid?: string): AgentContextRef[] | undefined {
  if (!userUuid && !errorUuid) return undefined
  const messages = getAgentSessionSDKMessages(sessionId)
  if (userUuid) {
    const user = messages.find((message) => message.type === 'user' && (message as { uuid?: string }).uuid === userUuid)
    if (!user) throw new Error('重试的原用户消息不存在')
    return parseReferenceSnapshot((user as { contextRefs?: unknown }).contextRefs ?? [])
  }
  const errorIndex = messages.findIndex((message) => message.type === 'assistant' && (message as { uuid?: string }).uuid === errorUuid && Boolean((message as { error?: unknown }).error))
  if (errorIndex < 0) throw new Error('重试的错误消息不存在')
  const user = messages.slice(0, errorIndex).reverse().find((message) => message.type === 'user')
  return parseReferenceSnapshot((user as { contextRefs?: unknown } | undefined)?.contextRefs ?? [])
}

/** 磁盘/IPC 数据结构校验；仅 Main 保存入口可以建立权威快照。 */
export function parseReferenceSnapshot(value: unknown): AgentContextRef[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('消息引用快照无效')
  const seen = new Set<string>()
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('消息引用快照无效')
    const ref = item as Record<string, unknown>
    if (typeof ref.refId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ref.refId) || seen.has(ref.refId)
      || typeof ref.sourceConversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ref.sourceConversationId)
      || typeof ref.sourceProjectId !== 'string' || typeof ref.titleAtAttach !== 'string'
      || (ref.mode !== 'snapshot' && ref.mode !== 'live')) throw new Error('消息引用快照无效')
    seen.add(ref.refId)
    const parsed: AgentContextRef = { refId: ref.refId, sourceConversationId: ref.sourceConversationId, sourceProjectId: ref.sourceProjectId, titleAtAttach: ref.titleAtAttach, mode: ref.mode }
    if (ref.snapshotUpToMessageId !== undefined) {
      if (typeof ref.snapshotUpToMessageId !== 'string') throw new Error('快照截止 ID 无效')
      parsed.snapshotUpToMessageId = ref.snapshotUpToMessageId
    }
    for (const key of ['snapshotAt', 'messageCount', 'estTokens'] as const) {
      if (ref[key] !== undefined) {
        if (typeof ref[key] !== 'number' || !Number.isFinite(ref[key]) || ref[key] < 0) throw new Error('快照数值无效')
        parsed[key] = ref[key]
      }
    }
    return parsed
  })
}

/** Pi 消费用户消息时才切换权限；仅入队不得改变当前正在运行的工具白名单。 */
export class ReferenceTurnTracker {
  private current: AgentContextRef[]
  private pending: Array<{ key: string; prompt: string; refs: AgentContextRef[] }> = []
  constructor(refs: AgentContextRef[]) { this.current = structuredClone(refs) }
  get = (): AgentContextRef[] => structuredClone(this.current)
  register(key: string, prompt: string, refs: AgentContextRef[]): void { this.pending.push({ key, prompt, refs: structuredClone(refs) }) }
  discard(key: string): void { this.pending = this.pending.filter((item) => item.key !== key) }
  consume(prompt: string): void {
    const index = this.pending.findIndex((item) => item.prompt === prompt)
    if (index < 0) return
    this.current = this.pending.splice(index, 1)[0]!.refs
  }
}
