/**
 * 会话引用动态注入器 (Conversation Reference Context Injector)
 *
 * 负责在运行时将 <referenced_conversations> 动态注入请求消息中。
 * 纯内存变换，不持久化到 JSONL 会话历史，自动免疫会话压缩与截断。
 */

import { existsSync } from 'node:fs'
import { getAgentContextRefs, getAgentSessionMeta } from '../agent-session-manager'
import { getReferencedMessagesForRef } from './pi-tools'
import { computeSummaryHash, getSnapshotCacheFilePathByRefId, loadSnapshotFromCache, loadSummaryFromCache } from './ref-cache'
import {
  buildReferencedContext,
  DEFAULT_BUDGET_RATIO,
  type ReferencedConversationData,
} from './context-builder'
import type { AgentContextRef } from '@gamma/shared'
import { inferBudgetContextWindow } from '@gamma/shared'

/**
 * 将引用的上下文 prompt 注入到即将发送给模型的 messages 列表中
 *
 * 策略：定位最后一条用户消息，将引用内容前置拼入该消息的 text 内容中。
 * 既保证在所有模型渠道（OpenAI / Anthropic / Gemini / DeepSeek 等）上保持严格的角色交替协议，
 * 又确保引用内容作为最新背景材料被模型读取。
 */
export function injectReferencedConversationsIntoMessages<
  T extends { role: string; content?: unknown; timestamp?: number }
>(
  messages: readonly T[],
  injectedPrompt: string,
): T[] {
  if (!injectedPrompt || !injectedPrompt.trim()) {
    return [...messages]
  }

  const promptBlock = injectedPrompt.trim() + '\n\n'
  const result: T[] = messages.map((m) => {
    // 浅克隆消息对象
    return { ...m }
  })

  // 寻找最后一条 user 消息
  let lastUserIndex = -1
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i]?.role === 'user') {
      lastUserIndex = i
      break
    }
  }

  if (lastUserIndex === -1) {
    // 若不存在 user 消息，追加一条 user 消息
    const newMsg = {
      role: 'user',
      timestamp: Date.now(),
      content: [{ type: 'text', text: injectedPrompt.trim() }],
    } as unknown as T
    result.push(newMsg)
    return result
  }

  const targetMsg = result[lastUserIndex]!
  const rawContent = targetMsg.content

  if (typeof rawContent === 'string') {
    targetMsg.content = promptBlock + rawContent
  } else if (Array.isArray(rawContent)) {
    const clonedArray = rawContent.map((b) => (typeof b === 'object' && b !== null ? { ...b } : b))
    // 寻找第一个 text 类型的 content block
    const firstTextBlock = clonedArray.find(
      (b): b is { type: string; text: string } =>
        typeof b === 'object' && b !== null && b.type === 'text' && typeof b.text === 'string',
    )
    if (firstTextBlock) {
      firstTextBlock.text = promptBlock + firstTextBlock.text
    } else {
      clonedArray.unshift({ type: 'text', text: injectedPrompt.trim() })
    }
    targetMsg.content = clonedArray
  } else {
    targetMsg.content = [{ type: 'text', text: injectedPrompt.trim() }]
  }

  return result
}

export interface InjectConversationReferencesContextOptions<T> {
  sessionId: string
  contextRefs?: AgentContextRef[]
  channelId?: string
  modelId?: string
  contextWindow?: number
  messages: readonly T[]
  signal?: AbortSignal
}

/** 注入与后台预算共用同一只读数据解析，缺失/归属/冻结边界一并计入。 */
export function resolveReferencedConversationData(activeRefs: readonly AgentContextRef[]): ReferencedConversationData[] {
  const resolvedDataList: ReferencedConversationData[] = []

  for (const ref of activeRefs) {
    // 校验源会话是否仍存在；源会话被删除或归属不符时记录不可用原因，计入预算注入不可用提示
    const sourceMeta = getAgentSessionMeta(ref.sourceConversationId)
    if (!sourceMeta) {
      resolvedDataList.push({
        refId: ref.refId,
        sourceConversationId: ref.sourceConversationId,
        sourceProjectId: ref.sourceProjectId,
        title: ref.titleAtAttach || '未命名对话',
        mode: ref.mode,
        snapshotUpToMessageId: ref.snapshotUpToMessageId,
        snapshotAt: ref.snapshotAt,
        messages: [],
        unavailableReason: '源对话已删除',
      })
      continue
    }

    if (ref.sourceProjectId !== (sourceMeta.workspaceId ?? '')) {
      resolvedDataList.push({
        refId: ref.refId,
        sourceConversationId: ref.sourceConversationId,
        sourceProjectId: ref.sourceProjectId,
        title: sourceMeta.title || ref.titleAtAttach || '未命名对话',
        mode: ref.mode,
        snapshotUpToMessageId: ref.snapshotUpToMessageId,
        snapshotAt: ref.snapshotAt,
        messages: [],
        unavailableReason: '对话归属项目不符',
      })
      continue
    }

    if (ref.mode === 'snapshot') {
      const cachePath = getSnapshotCacheFilePathByRefId(ref.refId)
      if (!existsSync(cachePath)) {
        resolvedDataList.push({
          refId: ref.refId,
          sourceConversationId: ref.sourceConversationId,
          sourceProjectId: ref.sourceProjectId,
          title: ref.titleAtAttach || sourceMeta.title || '未命名对话',
          mode: ref.mode,
          snapshotUpToMessageId: ref.snapshotUpToMessageId,
          snapshotAt: ref.snapshotAt,
          messages: [],
          unavailableReason: '快照缓存缺失',
        })
        continue
      }

      const cached = loadSnapshotFromCache(ref.refId, ref.snapshotUpToMessageId)
      if (
        !cached ||
        cached.refId !== ref.refId ||
        cached.sourceConversationId !== ref.sourceConversationId ||
        cached.sourceProjectId !== ref.sourceProjectId ||
        (ref.snapshotUpToMessageId && cached.snapshotUpToMessageId !== ref.snapshotUpToMessageId) ||
        (!ref.snapshotUpToMessageId && cached.messages.length > 0)
      ) {
        resolvedDataList.push({
          refId: ref.refId,
          sourceConversationId: ref.sourceConversationId,
          sourceProjectId: ref.sourceProjectId,
          title: ref.titleAtAttach || sourceMeta.title || '未命名对话',
          mode: ref.mode,
          snapshotUpToMessageId: ref.snapshotUpToMessageId,
          snapshotAt: ref.snapshotAt,
          messages: [],
          unavailableReason: '快照缓存损坏',
        })
        continue
      }

      const normMessages = cached.messages
      const prevTitles: string[] = []
      if (cached.previousReferencedTitles && cached.previousReferencedTitles.length > 0) {
        prevTitles.push(...cached.previousReferencedTitles)
      } else if (sourceMeta.contextRefs && sourceMeta.contextRefs.length > 0) {
        for (const nested of sourceMeta.contextRefs) {
          if (nested.titleAtAttach) prevTitles.push(nested.titleAtAttach)
        }
      }

      resolvedDataList.push({
        refId: ref.refId,
        sourceConversationId: ref.sourceConversationId,
        sourceProjectId: ref.sourceProjectId,
        title: sourceMeta.title || ref.titleAtAttach,
        mode: ref.mode,
        snapshotUpToMessageId: ref.snapshotUpToMessageId,
        snapshotAt: ref.snapshotAt,
        messages: normMessages,
        previousReferencedTitles: prevTitles.length > 0 ? prevTitles : undefined,
      })
      continue
    }

    const normMessages = getReferencedMessagesForRef(ref)
    const prevTitles: string[] = []
    if (sourceMeta.contextRefs && sourceMeta.contextRefs.length > 0) {
      for (const nested of sourceMeta.contextRefs) {
        if (nested.titleAtAttach) prevTitles.push(nested.titleAtAttach)
      }
    }

    resolvedDataList.push({
      refId: ref.refId,
      sourceConversationId: ref.sourceConversationId,
      sourceProjectId: ref.sourceProjectId,
      title: sourceMeta.title || ref.titleAtAttach,
      mode: ref.mode,
      snapshotUpToMessageId: ref.snapshotUpToMessageId,
      snapshotAt: ref.snapshotAt,
      messages: normMessages,
      previousReferencedTitles: prevTitles.length > 0 ? prevTitles : undefined,
    })
  }

  return resolvedDataList
}

/**
 * 在每轮推理前，动态解析并注入会话引用上下文
 */
export async function injectConversationReferencesContext<
  T extends { role: string; content?: unknown; timestamp?: number }
>(options: InjectConversationReferencesContextOptions<T>): Promise<T[]> {
  const { sessionId, modelId, contextWindow, messages, signal } = options
  const activeRefs = options.contextRefs ?? getAgentContextRefs(sessionId)
  if (signal?.aborted || !activeRefs || activeRefs.length === 0) {
    return [...messages]
  }

  const budgetTokens = Math.floor(inferBudgetContextWindow(modelId, contextWindow) * DEFAULT_BUDGET_RATIO)
  const resolvedDataList = resolveReferencedConversationData(activeRefs)
  const modelSummaries = new Map<string, string>()

  if (resolvedDataList.length === 0) {
    return [...messages]
  }

  // 与最终构建使用同一分档决策，工具/附件/包裹开销不能漏算。
  const initial = buildReferencedContext(resolvedDataList, budgetTokens)
  if (initial.tier === 'B') {
    // 发送路径只读缓存，绝不等待或启动模型摘要；未就绪立即使用受预算摘录。B 不能以旧 summary 覆盖不可用提示。
    for (const refData of resolvedDataList) {
      if (refData.unavailableReason) continue
      const summary = loadSummaryFromCache(refData.sourceConversationId,
        refData.snapshotUpToMessageId ?? 'latest', computeSummaryHash(refData.sourceConversationId, refData.messages))
      if (summary) modelSummaries.set(refData.refId, summary)
    }
  }

  if (signal?.aborted) return [...messages]
  const result = modelSummaries.size > 0
    ? buildReferencedContext(resolvedDataList, budgetTokens, { modelSummaries })
    : initial
  for (const decision of result.decisionLogs) console.log('[会话引用]', JSON.stringify(decision))
  if (!result.injectedPrompt) {
    return [...messages]
  }

  return injectReferencedConversationsIntoMessages(messages, result.injectedPrompt)
}
