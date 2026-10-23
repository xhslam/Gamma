import type { AgentContextRef } from '@gamma/shared'
import { getAgentContextRefs, getAgentSessionSDKMessages } from '../agent-session-manager'
import type { AgentReferenceWarningNotice } from '@gamma/shared'

export type ReferenceWarningNotice = AgentReferenceWarningNotice

export const REFERENCE_FALLBACK_WARNING = '引用准备失败，已转为无引用继续发送'

type ReferenceWarningListener = (notice: ReferenceWarningNotice) => void
const warningListeners = new Set<ReferenceWarningListener>()

export function registerReferenceWarningListener(listener: ReferenceWarningListener): () => void {
  warningListeners.add(listener)
  return () => {
    warningListeners.delete(listener)
  }
}

export function emitReferenceWarning(notice: ReferenceWarningNotice): void {
  for (const listener of warningListeners) {
    try {
      listener(notice)
    } catch {
      console.warn('[AgentReference] 无法投递引用降级通知')
    }
  }
}

export function isReferencePreparationError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error) {
    const msg = err.message
    return msg.includes('引用')
      || msg.includes('快照')
      || msg.includes('未获授权')
      || msg.includes('重试的原用户消息不存在')
      || msg.includes('重试的错误消息不存在')
  }
  return false
}

export interface PrepareAgentReferenceOptions {
  savedRefs?: AgentContextRef[]
  onWarning?: (warning: string) => void
}

/** 只接受 Main 当前已授权的 refId；不信任 renderer 传来的源路径、标题或快照描述。 */
export function captureReferenceSnapshot(sessionId: string, ids?: string[]): AgentContextRef[] {
  if (Array.isArray(ids) && ids.length === 0) return []
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

/** 保存、初次提交、失败状态回写均复用同一 Main 冻结描述。 */
export function prepareAgentReferenceInput<
  T extends {
    sessionId: string
    contextRefIds?: string[]
    contextRefs?: AgentContextRef[]
    retryOfUserMessageUuid?: string
    retryOfErrorUuid?: string
  }
>(
  input: T,
  messageIdOrOptions?: string | PrepareAgentReferenceOptions,
  fallbackWarningCallback?: (warning: string) => void
): T {
  const options: PrepareAgentReferenceOptions = typeof messageIdOrOptions === 'object' && messageIdOrOptions !== null
    ? messageIdOrOptions
    : { onWarning: fallbackWarningCallback }

  // 显式 [] 短路：若明确传 [] 且不是重试，不读任何引用存储或缓存，保持零额外开销
  if (Array.isArray(input.contextRefIds) && input.contextRefIds.length === 0 && !input.retryOfUserMessageUuid && !input.retryOfErrorUuid && options.savedRefs === undefined) {
    return { ...input, contextRefIds: [], contextRefs: [] }
  }

  try {
    const saved = options.savedRefs
    const refs = saved
      ?? getRetryReferenceSnapshot(input.sessionId, input.retryOfUserMessageUuid, input.retryOfErrorUuid)
      ?? captureReferenceSnapshot(input.sessionId, input.contextRefIds)
    return {
      ...input,
      contextRefIds: refs.map((ref) => ref.refId),
      contextRefs: structuredClone(refs),
    }
  } catch {
    // 此边界只包含引用读取/冻结操作，不捕获发送、落盘或调度的业务异常。
    notifyReferenceFallback(input.sessionId, options.onWarning)
    return { ...input, contextRefIds: [], contextRefs: [] }
  }

}



/** 通知失败也不能阻止原消息发送；日志及事件均不携带底层错误内容。 */
function notifyReferenceFallback(sessionId: string, onWarning?: (warning: string) => void): void {
  console.warn('[AgentReference] 引用准备失败，继续无引用发送')
  try { onWarning?.(REFERENCE_FALLBACK_WARNING) } catch {
    console.warn('[AgentReference] 无法投递引用降级通知')
  }
  emitReferenceWarning({ sessionId, warning: REFERENCE_FALLBACK_WARNING })
}

/** 非桌面入口同样降级；只捕获引用操作，业务执行仍由调用者负责。 */
export function captureReferenceSnapshotOrEmpty(sessionId: string, ids?: string[]): AgentContextRef[] {
  try { return captureReferenceSnapshot(sessionId, ids) } catch {
    notifyReferenceFallback(sessionId)
    return []
  }
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
