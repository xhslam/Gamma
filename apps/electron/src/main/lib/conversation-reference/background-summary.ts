import type { AgentContextRef, ReferenceSummaryProgress, ReferenceSummaryStatus } from '@gamma/shared'
import {
  DEFAULT_BUDGET_RATIO,
  ABSOLUTE_TIER_A_TOKEN_LIMIT,
  inferBudgetContextWindow,
} from '@gamma/shared'
import { getConfigDir } from '../config-paths'
import { getReferencedMessagesForRef } from './pi-tools'
import { computeSummaryHash, isFallbackSummary, loadSummaryFromCache } from './ref-cache'
import {
  getOrGenerateConversationSummary,
  MAX_SUMMARY_CHUNKS_PER_REF,
  CHUNK_MESSAGE_SIZE,
} from './summary-service'
import type { GenerateConversationSummaryInput } from './summary-service'

export { MAX_SUMMARY_CHUNKS_PER_REF, CHUNK_MESSAGE_SIZE }
export const MAX_GLOBAL_SUMMARY_CONCURRENCY = 2

interface SummaryJob {
  owner: string
  hash: string
  route: string
  controller: AbortController
  status: ReferenceSummaryStatus
  progress?: ReferenceSummaryProgress
}

export interface ReconcileReferenceSummariesResult {
  summaryStatuses: Record<string, ReferenceSummaryStatus>
  summaryProgresses: Record<string, ReferenceSummaryProgress>
  [refId: string]: ReferenceSummaryStatus | Record<string, ReferenceSummaryStatus> | Record<string, ReferenceSummaryProgress>
}

export interface BackgroundSummaryDeps {
  namespace?: string
  getMessages?: typeof getReferencedMessagesForRef
  loadSummary?: typeof loadSummaryFromCache
  generate?: (input: GenerateConversationSummaryInput) => Promise<string | null>
  maxConcurrency?: number
  maxChunksPerRef?: number
  chunkSize?: number
  forceTier?: 'A' | 'B'
  inferBudgetWindow?: typeof inferBudgetContextWindow
  budgetRatio?: number
}

const jobs = new Map<string, SummaryJob>()

// 全局并发控制池
let currentActiveConcurrency = 0
const pendingQueue: Array<{
  key: string
  signal: AbortSignal
  run: () => Promise<void>
}> = []

export function getActiveSummaryConcurrency(): number {
  return currentActiveConcurrency
}

export function resetSummaryQueueForTest(): void {
  for (const job of jobs.values()) {
    job.controller.abort()
  }
  jobs.clear()
  pendingQueue.length = 0
  currentActiveConcurrency = 0
}

function pumpSummaryQueue(maxConcurrency: number): void {
  // 清理等待队列中已 abort 的任务
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
    if (pendingQueue[i]!.signal.aborted) {
      pendingQueue.splice(i, 1)
    }
  }

  while (currentActiveConcurrency < maxConcurrency && pendingQueue.length > 0) {
    const next = pendingQueue.shift()!
    if (next.signal.aborted) {
      continue
    }
    currentActiveConcurrency++
    void Promise.resolve()
      .then(next.run)
      .finally(() => {
        currentActiveConcurrency--
        pumpSummaryQueue(maxConcurrency)
      })
  }
}

/** 判断当前引用列表是否需要触发 Tier B 模型摘要 */
export function shouldTriggerTierBSummary(
  refs: readonly AgentContextRef[],
  modelId: string | undefined,
  deps: BackgroundSummaryDeps = {},
): boolean {
  if (deps.forceTier === 'B') return true
  if (deps.forceTier === 'A') return false
  const windowTokens = (deps.inferBudgetWindow ?? inferBudgetContextWindow)(modelId)
  const budgetRatio = deps.budgetRatio ?? DEFAULT_BUDGET_RATIO
  const calculatedBudget = Math.floor(windowTokens * budgetRatio)
  const effectiveBudget = Math.min(calculatedBudget, ABSOLUTE_TIER_A_TOKEN_LIMIT)

  let totalTokens = 0
  for (const ref of refs) {
    const messages = (deps.getMessages ?? getReferencedMessagesForRef)(ref)
    let refTokens = 50
    for (const m of messages) {
      refTokens += Math.ceil((m.content?.length ?? 0) * 1.3) + 10
    }
    totalTokens += refTokens
  }
  return totalTokens > effectiveBudget
}

/** 只启动后台任务，永不等待模型。相同ref/hash共享任务，删除、切换模式或内容更新使旧任务失效。 */
export function reconcileReferenceSummaries(
  sessionId: string,
  refs: readonly AgentContextRef[],
  channelId?: string,
  modelId?: string,
  deps: BackgroundSummaryDeps = {},
): ReconcileReferenceSummariesResult {
  const maxConcurrency = deps.maxConcurrency ?? MAX_GLOBAL_SUMMARY_CONCURRENCY
  const maxChunksLimit = deps.maxChunksPerRef ?? MAX_SUMMARY_CHUNKS_PER_REF
  const chunkSize = deps.chunkSize ?? CHUNK_MESSAGE_SIZE

  const owner = `${deps.namespace ?? getConfigDir()}:${sessionId}`
  const prefix = `${owner}:`
  const active = new Set(refs.map((ref) => prefix + ref.refId))

  // 取消并清理非活动 job，取消立即释放槽位
  for (const [key, job] of jobs) {
    if (job.owner === owner && !active.has(key)) {
      job.controller.abort()
      jobs.delete(key)
    }
  }
  pumpSummaryQueue(maxConcurrency)

  const statuses: Record<string, ReferenceSummaryStatus> = {}
  const progresses: Record<string, ReferenceSummaryProgress> = {}

  // 判断是否需要 Tier B 摘要：整体超预算需 B 时才触发
  const isTierB = shouldTriggerTierBSummary(refs, modelId, deps)

  for (const ref of refs) {
    const key = prefix + ref.refId
    const messages = (deps.getMessages ?? getReferencedMessagesForRef)(ref)
    const hash = computeSummaryHash(ref.sourceConversationId, messages)
    const route = `${channelId ?? ''}:${modelId ?? ''}`

    // 1. 检查持久缓存
    const cached = (deps.loadSummary ?? loadSummaryFromCache)(
      ref.sourceConversationId,
      ref.snapshotUpToMessageId ?? 'latest',
      hash,
    )

    // 若持久缓存已是完整且非 fallback 摘要，直接就绪，不调用模型
    if (cached && !isFallbackSummary(cached)) {
      const previous = jobs.get(key)
      if (previous) {
        previous.controller.abort()
        jobs.delete(key)
      }
      statuses[ref.refId] = 'ready'
      continue
    }

    // 若无缓存且在有效预算内（Tier A 小引用）：直接 ready，绝不调模型
    if (!cached && !isTierB) {
      const previous = jobs.get(key)
      if (previous) {
        previous.controller.abort()
        jobs.delete(key)
      }
      statuses[ref.refId] = 'ready'
      continue
    }

    // 2. 超预算需 B 或 命中 fallback 质量标记：需受控调度
    const previous = jobs.get(key)
    if (previous?.hash === hash && previous.route === route) {
      statuses[ref.refId] = previous.status
      if (previous.progress) progresses[ref.refId] = previous.progress
      continue
    }

    if (previous) {
      previous.controller.abort()
      jobs.delete(key)
    }

    // 检查分块上限封顶：超上限必须 fallback 而非假完整 ready
    const totalChunks = Math.max(1, Math.ceil(messages.length / chunkSize))
    if (totalChunks > maxChunksLimit) {
      console.warn(`[会话引用摘要] 分块数 (${totalChunks}) 超过单引用上限 (${maxChunksLimit})，标记为 fallback`)
      statuses[ref.refId] = 'fallback'
      continue
    }

    const initialProgress: ReferenceSummaryProgress = { completed: 0, total: totalChunks }
    const initialStatus: ReferenceSummaryStatus = cached
      ? 'fallback'
      : totalChunks > 1
        ? `running:0/${totalChunks}`
        : 'running'

    const job: SummaryJob = {
      owner,
      hash,
      route,
      controller: new AbortController(),
      status: initialStatus,
      progress: initialProgress,
    }
    jobs.set(key, job)

    const executeTask = async (): Promise<void> => {
      if (job.controller.signal.aborted || jobs.get(key) !== job) return

      await new Promise<void>((resolve) => {
        let settled = false
        const onAbort = () => {
          if (settled) return
          settled = true
          resolve()
        }

        if (job.controller.signal.aborted) {
          return resolve()
        }
        job.controller.signal.addEventListener('abort', onAbort, { once: true })

        Promise.resolve()
          .then(() => (deps.generate ?? getOrGenerateConversationSummary)({
            channelId,
            modelId,
            sourceConversationId: ref.sourceConversationId,
            snapshotUpToMessageId: ref.snapshotUpToMessageId ?? 'latest',
            messages,
            signal: job.controller.signal,
            deps: {
              chunkSize,
              maxChunksPerRef: maxChunksLimit,
            },
            onProgress: (p) => {
              if (jobs.get(key) === job && !job.controller.signal.aborted) {
                job.progress = p
                job.status = `running:${p.completed}/${p.total}`
              }
            },
          }))
          .then(
            (summary) => {
              job.controller.signal.removeEventListener('abort', onAbort)
              if (!settled) {
                settled = true
                if (jobs.get(key) === job && !job.controller.signal.aborted) {
                  job.status = summary && !isFallbackSummary(summary) ? 'ready' : 'fallback'
                  if (job.status === 'ready') {
                    job.progress = { completed: totalChunks, total: totalChunks }
                  }
                }
                resolve()
              }
            },
            () => {
              job.controller.signal.removeEventListener('abort', onAbort)
              if (!settled) {
                settled = true
                if (jobs.get(key) === job && !job.controller.signal.aborted) {
                  job.status = 'fallback'
                }
                resolve()
              }
            }
          )
      })
    }

    pendingQueue.push({
      key,
      signal: job.controller.signal,
      run: executeTask,
    })
    pumpSummaryQueue(maxConcurrency)

    statuses[ref.refId] = job.status
    if (job.progress) progresses[ref.refId] = job.progress
  }

  const result: ReconcileReferenceSummariesResult = {
    ...statuses,
    summaryStatuses: statuses,
    summaryProgresses: progresses,
  }
  return result
}
