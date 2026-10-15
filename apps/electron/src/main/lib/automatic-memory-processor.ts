import type { AutomaticMemoryCandidate, AutomaticMemoryChange, AutomaticMemorySnapshot, AutomaticMemorySource } from '@gamma/shared'
import { buildAutomaticMemoryExtractionPrompt, getAutomaticMemoryUserText, parseAutomaticMemoryCandidates } from './automatic-memory-extraction'

export interface AutomaticMemoryJob {
  workspaceSlug: string
  source: AutomaticMemorySource
  userText: string
  channelId: string
  modelId: string
  /** 提交前再次核验会话存在，阻止删除会话后仍保存新记忆。 */
  isSourceAvailable?: () => boolean
}

export interface AutomaticMemoryProcessorDependencies {
  getSnapshot: (slug: string) => AutomaticMemorySnapshot
  extract: (prompt: string, job: AutomaticMemoryJob) => Promise<string>
  apply: (slug: string, candidates: AutomaticMemoryCandidate[], source: AutomaticMemorySource, text: string, revision: number) => AutomaticMemoryChange[]
  publish: (change: AutomaticMemoryChange) => void
  onFailure?: (job: AutomaticMemoryJob) => void
}

/** 每工作区串行，跨工作区独立；失败不阻塞下一条或正常聊天。 */
export class AutomaticMemoryProcessor {
  private queues = new Map<string, Promise<void>>()
  private pending = new Map<string, number>()
  constructor(private readonly deps: AutomaticMemoryProcessorDependencies) {}

  enqueue(job: AutomaticMemoryJob): Promise<void> {
    const count = this.pending.get(job.workspaceSlug) ?? 0
    if (count >= 32) {
      this.deps.onFailure?.(job)
      return Promise.resolve()
    }
    // 入队时捕获策略/修订：之后关闭、删除或编辑会使旧候选失效。
    let initial: AutomaticMemorySnapshot
    try { initial = this.deps.getSnapshot(job.workspaceSlug) } catch {
      this.deps.onFailure?.(job)
      return Promise.resolve()
    }
    if (!initial.settings.enabled) return Promise.resolve()
    this.pending.set(job.workspaceSlug, count + 1)
    const previous = this.queues.get(job.workspaceSlug) ?? Promise.resolve()
    const next = previous.then(async () => {
      const userText = getAutomaticMemoryUserText(job.userText)
      if (!userText || job.isSourceAvailable?.() === false) return
      const snapshot = this.deps.getSnapshot(job.workspaceSlug)
      // 自动提交可推进数据revision而不取消正常后续消息；用户关闭、编辑、
      // 删除等操作推进独立策略代数，已排队旧消息不能在重新开启后补存。
      if (!snapshot.settings.enabled || (snapshot.policyRevision ?? 0) !== (initial.policyRevision ?? 0)) return
      const output = await this.deps.extract(buildAutomaticMemoryExtractionPrompt(userText, snapshot), job)
      if (job.isSourceAvailable?.() === false) return
      const candidates = parseAutomaticMemoryCandidates(output, userText)
      const changes = this.deps.apply(job.workspaceSlug, candidates, job.source, userText, snapshot.revision)
      for (const change of changes) this.deps.publish(change)
    }).catch(() => {
      // 不打印prompt、响应、HTTP错误正文，避免敏感信息落入日志。
      this.deps.onFailure?.(job)
    }).finally(() => {
      const remaining = (this.pending.get(job.workspaceSlug) ?? 1) - 1
      if (remaining > 0) this.pending.set(job.workspaceSlug, remaining)
      else this.pending.delete(job.workspaceSlug)
      if (this.queues.get(job.workspaceSlug) === next) this.queues.delete(job.workspaceSlug)
    })
    this.queues.set(job.workspaceSlug, next)
    return next
  }
}
