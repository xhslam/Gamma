/**
 * 会话引用 Pi 工具扩展 (Conversation Reference Pi Extension Tools)
 *
 * 注册 3 个专用工具供 Agent 在需要深层背景事实时按需检索：
 * 1. list_referenced_conversations()
 * 2. read_referenced_conversation({ id, offset, limit })
 * 3. search_referenced_conversation({ id, query })
 *
 * 安全约束：
 * - 仅接受当前会话 contextRefs 白名单中的 refId，杜绝越权访问任意 session ID。
 * - 格式校验防路径穿越。
 * - 快照边界保护：不可读取 snapshotUpToMessageId 之后的实时消息。
 * - 相同规范化清洗（丢 thinking / base64，截断工具输出，附件仅元数据）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type, type Static } from 'typebox'
import { getAgentSessionMeta, getAgentSessionSDKMessages } from '../agent-session-manager'
import {
  loadSnapshotFromCache,
  computeSnapshotHash,
  loadSummaryFromCache,
} from './ref-cache'
import {
  formatNormalizedMessage,
  normalizeSDKMessage,
  normalizeCompleteSDKMessages,
  redactCredentials,
  type NormalizedReferencedMessage,
} from './context-builder'

export { normalizeSDKMessage }
import type { AgentContextRef, SDKMessage } from '@gamma/shared'

/** 工具输出最大字符上限（防单次工具调用输出过大导致 Token 爆炸） */
const MAX_TOOL_OUTPUT_CHARS = 8000

/** 关键词搜索最大返回条数 */
const MAX_SEARCH_RESULTS = 10

/** ID 合法字符正则（字母、数字、下划线、短横线） */
const VALID_REF_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/

function ok(text: string): AgentToolResult<undefined> {
  return {
    content: [{ type: 'text', text: redactCredentials(text) }],
    details: undefined,
  }
}

function errorResult(message: string): AgentToolResult<undefined> {
  return {
    content: [{ type: 'text', text: `[错误]: ${redactCredentials(message)}` }],
    details: undefined,
    isError: true,
  }
}

/**
 * 获取 SDK 消息的唯一标识符（兼容 id 与 uuid 字段）
 */
export function getSDKMessageId(m: SDKMessage): string {
  const anyMsg = m as { id?: string; uuid?: string }
  return String(anyMsg.id ?? anyMsg.uuid ?? '')
}

/**
 * 获取引用会话的有效规范化消息列表（受 snapshot 截止边界保护，缓存丢失严格 fail-closed）
 */
export function getReferencedMessagesForRef(ref: AgentContextRef): NormalizedReferencedMessage[] {
  if (!VALID_REF_ID_REGEX.test(ref.refId) || !VALID_REF_ID_REGEX.test(ref.sourceConversationId)) return []
  const source = getAgentSessionMeta(ref.sourceConversationId)
  if (!source || (source.workspaceId ?? '') !== ref.sourceProjectId) return []
  if (ref.mode === 'snapshot') {
    if (!ref.snapshotUpToMessageId) return []
    const cached = loadSnapshotFromCache(ref.refId)
    if (!cached || cached.refId !== ref.refId || cached.sourceConversationId !== ref.sourceConversationId
      || cached.sourceProjectId !== ref.sourceProjectId || cached.snapshotUpToMessageId !== ref.snapshotUpToMessageId) return []
    return cached.messages
  }
  return normalizeCompleteSDKMessages(getAgentSessionSDKMessages(ref.sourceConversationId))
}

// ===== 参数 Schemas =====

const ListReferencedConversationsParams = Type.Object({})

const ReadReferencedConversationParams = Type.Object({
  id: Type.String({
    description: '引用的会话 ID（必须是 list_referenced_conversations 中返回的 refId，如 ref_xxx）',
  }),
  offset: Type.Optional(Type.Integer({
    minimum: 0,
    description: '读取起始消息索引（从 0 开始），默认 0',
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 50,
    description: '读取的消息条数（1-50），默认 10',
  })),
})
type ReadReferencedConversationParamsType = Static<typeof ReadReferencedConversationParams>

const SearchReferencedConversationParams = Type.Object({
  id: Type.String({
    description: '引用的会话 ID（必须是 list_referenced_conversations 中返回的 refId，如 ref_xxx）',
  }),
  query: Type.String({
    minLength: 1,
    description: '要搜索的关键词或关键短语',
  }),
})
type SearchReferencedConversationParamsType = Static<typeof SearchReferencedConversationParams>

/**
 * 校验 refId 安全性并从当前会话的 contextRefs 白名单中查找
 */
export function validateAndFindRef(
  currentSessionId: string,
  refId: string,
  referenceSnapshot?: AgentContextRef[],
): { ref: AgentContextRef } | { error: string } {
  if (!refId || typeof refId !== 'string') {
    return { error: '缺少或无效的引用 ID' }
  }

  const trimmed = refId.trim()
  if (!VALID_REF_ID_REGEX.test(trimmed) || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return { error: `引用 ID 格式非法或包含危险字符: ${refId}` }
  }

  if (!currentSessionId || typeof currentSessionId !== 'string') {
    return { error: '缺少当前会话 ID' }
  }

  const currentMeta = getAgentSessionMeta(currentSessionId)
  if (!currentMeta) {
    return { error: `当前会话不存在: ${currentSessionId}` }
  }

  const activeRefs = referenceSnapshot ?? currentMeta.contextRefs ?? []
  const found = activeRefs.find((r) => r.refId === trimmed)
  if (!found) {
    return { error: `未授权的引用 ID 或该引用已被用户从本会话移除: ${trimmed}` }
  }

  // 校验源会话是否仍存在且未归档
  const sourceMeta = getAgentSessionMeta(found.sourceConversationId)
  if (!sourceMeta) {
    return { error: `引用的源会话已不存在或已被物理删除: ${found.sourceConversationId}` }
  }

  // 校验项目归属（防止跨项目伪造或越权）
  if (found.sourceProjectId !== (sourceMeta.workspaceId ?? '')) {
    return { error: `引用项目归属异常: 记录工作区 (${found.sourceProjectId}) 与实际工作区 (${sourceMeta.workspaceId}) 不符` }
  }

  return { ref: found }
}

/**
 * 创建会话引用扩展工厂 (Pi Extension Factory)
 */
export function createConversationReferenceExtension(sessionId: string, getReferences?: () => AgentContextRef[]) {
  return function conversationReferenceExtension(pi: ExtensionAPI): void {
    // 工具 1：列出当前会话中引用的所有历史会话
    pi.registerTool({
      name: 'list_referenced_conversations',
      label: 'list_referenced_conversations',
      description: '列出当前会话中用户主动引用的所有外部历史会话列表（包含 refId、标题、消息数量及快照信息）。',
      parameters: ListReferencedConversationsParams,
      async execute(): Promise<AgentToolResult<undefined>> {
        const meta = getAgentSessionMeta(sessionId)
        const activeRefs = getReferences?.() ?? meta?.contextRefs ?? []
        if (activeRefs.length === 0) {
          return ok('当前会话未附加任何引用的外部会话。')
        }

        const items = activeRefs.map((r) => {
          const sourceMeta = getAgentSessionMeta(r.sourceConversationId)
          const messages = getReferencedMessagesForRef(r)
          const contentHash = computeSnapshotHash(messages)
          const cachedSummary = r.snapshotUpToMessageId
            ? loadSummaryFromCache(r.sourceConversationId, r.snapshotUpToMessageId, contentHash)
            : null
          const safeTitle = redactCredentials(sourceMeta?.title || r.titleAtAttach)
          const safeSummarySnippet = cachedSummary
            ? redactCredentials(cachedSummary).slice(0, 150) + (cachedSummary.length > 150 ? '...' : '')
            : undefined
          return {
            id: r.refId,
            sourceConversationId: r.sourceConversationId,
            sourceProjectId: r.sourceProjectId,
            title: safeTitle,
            mode: r.mode,
            messageCount: messages.length,
            estTokens: r.estTokens ?? 0,
            snapshotAt: r.snapshotAt ? new Date(r.snapshotAt).toISOString() : undefined,
            snapshotUpToMessageId: r.snapshotUpToMessageId,
            summarySnippet: safeSummarySnippet,
            exists: Boolean(sourceMeta),
          }
        })

        return ok(JSON.stringify(items, null, 2))
      },
    })

    // 工具 2：分页读取指定引用会话的内容
    pi.registerTool({
      name: 'read_referenced_conversation',
      label: 'read_referenced_conversation',
      description: '按消息分页读取被引用会话的内容。仅允许读取用户当前主动引用的会话，严格遵守快照截止边界。',
      parameters: ReadReferencedConversationParams,
      async execute(_toolCallId: string, params: ReadReferencedConversationParamsType): Promise<AgentToolResult<undefined>> {
        if (!params || typeof params !== 'object') return errorResult('无效的工具参数')
        const check = validateAndFindRef(sessionId, params.id, getReferences?.())
        if ('error' in check) {
          return errorResult(check.error)
        }
        const ref = check.ref
        const messages = getReferencedMessagesForRef(ref)

        const safeTitle = redactCredentials(ref.titleAtAttach)
        const totalMessages = messages.length
        if (totalMessages === 0) {
          return ok(`会话 [${safeTitle}] 暂无可用历史消息。`)
        }

        if ((params.offset !== undefined && (!Number.isSafeInteger(params.offset) || params.offset < 0)) || (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 50))) return errorResult('offset/limit 必须是范围内的整数')
        const rawOffset = typeof params.offset === 'number' && Number.isFinite(params.offset) ? params.offset : 0
        const rawLimit = typeof params.limit === 'number' && Number.isFinite(params.limit) ? params.limit : 10
        const offset = Math.max(0, Math.floor(rawOffset))
        const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 50)
        const slice = messages.slice(offset, offset + limit)

        if (slice.length === 0) {
          return ok(`偏移量超出范围（总消息数: ${totalMessages}，当前 offset: ${offset}）。`)
        }

        const lines: string[] = [
          `--- 会话: ${safeTitle} (ID: ${ref.refId}) [消息 ${offset} 至 ${offset + slice.length - 1} / 共 ${totalMessages} 条] ---`,
        ]

        for (let i = 0; i < slice.length; i++) {
          const msg = slice[i]!
          const formatted = formatNormalizedMessage(msg, 150)
          lines.push(`\n[消息 #${offset + i}]\n${formatted}`)
        }

        let output = lines.join('\n')
        if (output.length > MAX_TOOL_OUTPUT_CHARS) {
          output = output.slice(0, MAX_TOOL_OUTPUT_CHARS) + '\n\n[... 内容超出单次输出限制，请使用更大的 offset 继续分页读取 ...]'
        }

        return ok(output)
      },
    })

    // 工具 3：在指定引用会话中搜索关键词及前后文
    pi.registerTool({
      name: 'search_referenced_conversation',
      label: 'search_referenced_conversation',
      description: '在被引用的会话历史中搜索关键词定位深层事实，返回匹配消息及其前后上下文。',
      parameters: SearchReferencedConversationParams,
      async execute(_toolCallId: string, params: SearchReferencedConversationParamsType): Promise<AgentToolResult<undefined>> {
        if (!params || typeof params !== 'object') return errorResult('无效的工具参数')
        const check = validateAndFindRef(sessionId, params.id, getReferences?.())
        if ('error' in check) {
          return errorResult(check.error)
        }
        const ref = check.ref
        if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
          return errorResult('搜索关键词不能为空')
        }
        const query = params.query.trim().toLowerCase()

        const messages = getReferencedMessagesForRef(ref)
        if (messages.length === 0) {
          return ok(`引用的对话里没有提到关键词 "${params.query}"（会话暂无消息）。`)
        }

        // 匹配检索
        interface MatchItem {
          index: number
          message: NormalizedReferencedMessage
        }
        const matches: MatchItem[] = []

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]!
          const contentMatch = msg.content.toLowerCase().includes(query)
          const toolMatch = msg.toolCalls?.some((t) =>
            t.name.toLowerCase().includes(query) ||
            (t.keyParam && t.keyParam.toLowerCase().includes(query)) ||
            (t.resultSummary && t.resultSummary.toLowerCase().includes(query)),
          )
          const attachMatch = msg.attachments?.some((a) => a.name.toLowerCase().includes(query))

          if (contentMatch || toolMatch || attachMatch) {
            matches.push({ index: i, message: msg })
            if (matches.length >= MAX_SEARCH_RESULTS) break
          }
        }

        if (matches.length === 0) {
          return ok(`引用的对话里没有提到关键词 "${params.query}"。`)
        }

        const safeTitle = redactCredentials(ref.titleAtAttach)
        const blocks: string[] = [
          `在会话 [${safeTitle}] 中检索到 ${matches.length} 处匹配：`,
        ]

        for (const match of matches) {
          const idx = match.index
          // 附带前 1 条与后 1 条上下文
          const contextStart = Math.max(0, idx - 1)
          const contextEnd = Math.min(messages.length - 1, idx + 1)

          const contextLines: string[] = [
            `\n>>> 匹配项 (消息 #${idx}) <<<`,
          ]

          for (let c = contextStart; c <= contextEnd; c++) {
            const contextMsg = messages[c]!
            const prefix = c === idx ? '【命中】' : '【上下文】'
            contextLines.push(`${prefix} #${c} ${formatNormalizedMessage(contextMsg, 120)}`)
          }

          blocks.push(contextLines.join('\n'))
        }

        let output = blocks.join('\n')
        if (output.length > MAX_TOOL_OUTPUT_CHARS) {
          output = output.slice(0, MAX_TOOL_OUTPUT_CHARS) + '\n\n[... 搜索结果超出输出上限，已截断 ...]'
        }

        return ok(output)
      },
    })
  }
}
