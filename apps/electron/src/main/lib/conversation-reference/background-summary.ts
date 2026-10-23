import type { AgentContextRef, ReferenceSummaryStatus } from '@gamma/shared'
import { getConfigDir } from '../config-paths'
import { getReferencedMessagesForRef } from './pi-tools'
import { computeSummaryHash, isFallbackSummary, loadSummaryFromCache } from './ref-cache'
import { getOrGenerateConversationSummary } from './summary-service'
import type { GenerateConversationSummaryInput } from './summary-service'

interface SummaryJob {
  owner: string
  hash: string
  route: string
  controller: AbortController
  status: ReferenceSummaryStatus
}
export interface BackgroundSummaryDeps {
  namespace?: string
  getMessages?: typeof getReferencedMessagesForRef
  loadSummary?: typeof loadSummaryFromCache
  generate?: (input: GenerateConversationSummaryInput) => Promise<string | null>
}
const jobs = new Map<string, SummaryJob>()

/** 只启动后台任务，永不等待模型。相同ref/hash共享任务，删除、切换模式或内容更新使旧任务失效。 */
export function reconcileReferenceSummaries(
  sessionId: string,
  refs: readonly AgentContextRef[],
  channelId?: string,
  modelId?: string,
  deps: BackgroundSummaryDeps = {},
): Record<string, ReferenceSummaryStatus> {
  const owner = `${deps.namespace ?? getConfigDir()}:${sessionId}`
  const prefix = `${owner}:`
  const active = new Set(refs.map((ref) => prefix + ref.refId))
  for (const [key, job] of jobs) {
    if (job.owner === owner && !active.has(key)) {
      job.controller.abort()
      jobs.delete(key)
    }
  }
  const statuses: Record<string, ReferenceSummaryStatus> = {}
  for (const ref of refs) {
    const key = prefix + ref.refId
    const messages = (deps.getMessages ?? getReferencedMessagesForRef)(ref)
    const hash = computeSummaryHash(ref.sourceConversationId, messages)
    const route = `${channelId ?? ''}:${modelId ?? ''}`
    const previous = jobs.get(key)
    if (previous?.hash === hash && previous.route === route) {
      statuses[ref.refId] = previous.status
      continue
    }
    previous?.controller.abort()
    const cached = (deps.loadSummary ?? loadSummaryFromCache)(ref.sourceConversationId, ref.snapshotUpToMessageId ?? 'latest', hash)
    const job: SummaryJob = { owner, hash, route, controller: new AbortController(), status: cached ? (isFallbackSummary(cached) ? 'fallback' : 'ready') : 'running' }
    jobs.set(key, job)
    if (!cached || isFallbackSummary(cached)) {
      void Promise.resolve().then(() => (deps.generate ?? getOrGenerateConversationSummary)({
        channelId, modelId, sourceConversationId: ref.sourceConversationId,
        snapshotUpToMessageId: ref.snapshotUpToMessageId ?? 'latest', messages, signal: job.controller.signal,
      })).then((summary) => {
        if (jobs.get(key) === job && !job.controller.signal.aborted) job.status = summary && !isFallbackSummary(summary) ? 'ready' : 'fallback'
      }, () => {
        if (jobs.get(key) === job && !job.controller.signal.aborted) job.status = 'fallback'
      })
    }
    statuses[ref.refId] = job.status
  }
  return statuses
}
