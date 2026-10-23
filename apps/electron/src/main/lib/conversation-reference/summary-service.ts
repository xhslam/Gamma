/**
 * 结构化会话摘要服务 (Conversation Reference Summary Service)
 *
 * 负责通过当前渠道模型为被引用的会话生成结构化摘要：
 * 目标、关键结论、重要决定、待办、关键文件/命令/数据。
 * 包含输入预算防溢出分块、30秒超时熔断、磁盘原子缓存与优雅降级。
 */

import { getAdapter, streamSSE } from '@gamma/core'
import {
  getChannelById,
  persistCodexOAuthCredentials,
  resolveChannelRuntimeApiKey,
  resolveCodexOAuthCredentials,
} from '../channel-manager'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { getFetchFn } from '../proxy-fetch'
import { generateCodexTitle } from '../adapters/pi-codex-title-generator'
import { extractAutomaticMemoryOAuth } from '../automatic-memory-oauth'
import {
  computeSnapshotHash,
  loadSummaryFromCache,
  saveSummaryToCache,
} from './ref-cache'
import {
  formatNormalizedMessage,
  type NormalizedReferencedMessage,
} from './context-builder'

/** 摘要生成最大输出 Token 限制 */
const SUMMARY_MAX_OUTPUT_TOKENS = 1500

/** 摘要生成超时时间（毫秒） */
const SUMMARY_TIMEOUT_MS = 30_000

/** 摘要提示词输入正文的最大字符预算（防模型输入溢出） */
const MAX_SUMMARY_INPUT_CHARS = 16_000

export const STRUCTURED_SUMMARY_PROMPT = `请针对以下引用的历史对话记录，生成一份精炼且准确的结构化背景摘要。
请严格按照以下 5 个维度输出（若某项在对话中无提及可注明无，不要编造）：
【目标】：本次对话要解决的核心问题或用户目标
【关键结论】：对话达成的明确结论或共识
【重要决定】：关键架构选择、方案决策或已废弃的替代方案
【待办】：遗留未完成的工作项或待跟进事项
【关键文件/命令/数据】：对话涉及的核心文件路径、命令、参数或关键数据

请直接输出上述 5 个维度的内容，不要添加额外的寒暄或多余文字。
对话内容如下：
`

/**
 * 将长消息列表压缩至输入字符预算内（保留头部目标与尾部结论）
 */
export function prepareSummaryInputText(messages: readonly NormalizedReferencedMessage[]): string {
  const formattedLines: string[] = []
  for (const m of messages) {
    formattedLines.push(formatNormalizedMessage(m, 120))
  }

  const fullText = formattedLines.join('\n\n')
  if (fullText.length <= MAX_SUMMARY_INPUT_CHARS) {
    return fullText
  }

  // 超出预算时保留前 1/3 和后 2/3，中间截断
  const headBudget = Math.floor(MAX_SUMMARY_INPUT_CHARS * 0.35)
  const tailBudget = Math.floor(MAX_SUMMARY_INPUT_CHARS * 0.60)

  let headText = ''
  let headIndex = 0
  for (let i = 0; i < formattedLines.length; i++) {
    const line = formattedLines[i]!
    if ((headText + line).length > headBudget) break
    headText += (headText ? '\n\n' : '') + line
    headIndex = i + 1
  }

  let tailText = ''
  let tailIndex = formattedLines.length
  for (let i = formattedLines.length - 1; i >= headIndex; i--) {
    const line = formattedLines[i]!
    if ((tailText + line).length > tailBudget) break
    tailText = line + (tailText ? '\n\n' : '') + tailText
    tailIndex = i
  }

  const omittedCount = Math.max(0, tailIndex - headIndex)
  const placeholder = omittedCount > 0 ? `\n\n[... 省略中间 ${omittedCount} 条上下文 ...]\n\n` : '\n\n'
  return headText + placeholder + tailText
}

export interface GenerateConversationSummaryInput {
  channelId?: string
  modelId?: string
  sourceConversationId: string
  snapshotUpToMessageId: string
  messages: readonly NormalizedReferencedMessage[]
  signal?: AbortSignal
}

/**
 * 为会话生成或获取已缓存的结构化模型摘要。
 * 若模型调用失败/超时/取消，返回 null 供调用方降级，绝不伪造虚假摘要。
 */
export async function getOrGenerateConversationSummary(
  input: GenerateConversationSummaryInput,
): Promise<string | null> {
  const { channelId, modelId, sourceConversationId, snapshotUpToMessageId, messages, signal } = input
  if (messages.length === 0) return null

  const contentHash = computeSnapshotHash(messages)

  // 1. 优先读取磁盘快照稳定缓存
  const cached = loadSummaryFromCache(sourceConversationId, snapshotUpToMessageId, contentHash)
  if (cached && cached.trim().length > 0) {
    return cached.trim()
  }

  // 2. 检查渠道与模型
  if (!channelId || !modelId) {
    console.log('[会话引用摘要] 未提供渠道或模型，跳过模型摘要生成')
    return null
  }

  const channel = getChannelById(channelId)
  if (!channel) {
    console.warn(`[会话引用摘要] 渠道不存在: ${channelId}`)
    return null
  }

  // 3. 构建输入并调用模型
  const sanitizedInputText = prepareSummaryInputText(messages)
  const prompt = `${STRUCTURED_SUMMARY_PROMPT}\n${sanitizedInputText}`

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), SUMMARY_TIMEOUT_MS)

  const abortListener = () => timeoutController.abort()
  signal?.addEventListener('abort', abortListener)

  try {
    const proxyUrl = await getEffectiveProxyUrl()

    let generatedText: string | null = null

    if (channel.provider === 'openai-codex') {
      const credentials = await resolveCodexOAuthCredentials(channelId)
      generatedText = await generateCodexTitle({
        modelId,
        prompt,
        credentials,
        proxyUrl,
        signal: timeoutController.signal,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        onCredentialsRefreshed: (refreshed) => persistCodexOAuthCredentials(channelId, refreshed),
      })
    } else if (channel.provider === 'github-copilot' || channel.provider === 'xai') {
      generatedText = await extractAutomaticMemoryOAuth({
        provider: channel.provider,
        channelId,
        modelId,
        prompt,
        signal: timeoutController.signal,
        proxyUrl,
      })
    } else {
      // 标准 Provider API Key 渠道
      const adapter = getAdapter(channel.provider)
      const apiKey = await resolveChannelRuntimeApiKey(channelId)
      const request = adapter.buildStreamRequest({
        baseUrl: channel.baseUrl,
        apiKey,
        modelId,
        history: [],
        userMessage: prompt,
        readImageAttachments: () => [],
        thinkingEnabled: false,
        thinkingLevel: 'off',
      })

      // 覆盖 maxOutputTokens
      try {
        const body = JSON.parse(request.body) as Record<string, unknown>
        if (channel.provider === 'google') {
          const config = typeof body.generationConfig === 'object' && body.generationConfig !== null
            ? body.generationConfig as Record<string, unknown> : {}
          body.generationConfig = { ...config, maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS }
        } else if (channel.provider === 'openai-responses') {
          body.max_output_tokens = SUMMARY_MAX_OUTPUT_TOKENS
        } else if ('max_tokens' in body || !/^(?:o\d|gpt-[5-9])/i.test(modelId)) {
          body.max_tokens = SUMMARY_MAX_OUTPUT_TOKENS
        }
        request.body = JSON.stringify(body)
      } catch {
        // parse error ignored
      }

      const result = await streamSSE({
        request,
        adapter,
        signal: timeoutController.signal,
        fetchFn: getFetchFn(proxyUrl),
        onEvent: () => {},
      })
      generatedText = result.content
    }

    if (!generatedText || generatedText.trim().length === 0) {
      console.warn('[会话引用摘要] 模型返回空摘要，回退到头尾截断')
      return null
    }

    const cleanSummary = generatedText.trim()
    // 保存至磁盘原子缓存
    saveSummaryToCache({
      sourceConversationId,
      snapshotUpToMessageId,
      contentHash,
      version: 'v1',
      createdAt: Date.now(),
      summary: cleanSummary,
    })

    console.log(`[会话引用摘要] 成功为会话 ${sourceConversationId} 生成结构化摘要 (${cleanSummary.length} 字符)`)
    return cleanSummary
  } catch (error) {
    if (signal?.aborted || timeoutController.signal.aborted) {
      console.log(`[会话引用摘要] 摘要生成中止或超时（${sourceConversationId}）`)
    } else {
      console.warn(`[会话引用摘要] 摘要生成失败（${sourceConversationId}）:`, error)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortListener)
  }
}
