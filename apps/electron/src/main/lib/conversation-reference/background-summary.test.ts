import { beforeEach, describe, expect, it } from 'bun:test'
import type { AgentContextRef } from '@gamma/shared'
import {
  reconcileReferenceSummaries,
  MAX_GLOBAL_SUMMARY_CONCURRENCY,
  MAX_SUMMARY_CHUNKS_PER_REF,
  getActiveSummaryConcurrency,
  resetSummaryQueueForTest,
} from './background-summary'
import type { BackgroundSummaryDeps } from './background-summary'

const refA: AgentContextRef = {
  refId: 'ref_small_a',
  sourceConversationId: 'source_small_a',
  sourceProjectId: 'fixture',
  titleAtAttach: '小引用A',
  mode: 'live',
}

const refB: AgentContextRef = {
  refId: 'ref_large_b',
  sourceConversationId: 'source_large_b',
  sourceProjectId: 'fixture',
  titleAtAttach: '大引用B',
  mode: 'live',
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function fixture(overrides: Partial<BackgroundSummaryDeps> = {}): BackgroundSummaryDeps {
  return {
    namespace: crypto.randomUUID(),
    getMessages: () => [{ id: 'm1', role: 'user', content: '普通小内容' }],
    loadSummary: () => null,
    forceTier: 'B', // 默认触发 B 以兼容原有通用测试
    ...overrides,
  }
}

describe('Feature: 后台摘要按预算调度、资源边界控制与真实进度', () => {
  beforeEach(() => {
    resetSummaryQueueForTest()
  })
  describe('Rule 1: A 小引用不得调模型，超预算需 B 时才触发', () => {
    it('When 小引用整体在预算内 Then 保持 Tier A，直接就绪且 generate 调用为 0', async () => {
      let generateCalled = 0
      const deps: BackgroundSummaryDeps = {
        namespace: crypto.randomUUID(),
        // 极短消息：总 token 远小于预算
        getMessages: () => [{ id: 'm1', role: 'user', content: '小引用内容' }],
        loadSummary: () => null,
        generate: async () => {
          generateCalled++
          return 'generated summary'
        },
        // 模拟正常模型预算（200k 窗口，35% 预算 = 70,000 tokens）
        inferBudgetWindow: () => 200_000,
        budgetRatio: 0.35,
      }

      const result = reconcileReferenceSummaries('target-session', [refA], 'channel', 'model', deps)
      // Tier A 小引用直接 ready
      expect(result[refA.refId]).toBe('ready')
      expect(result.summaryStatuses[refA.refId]).toBe('ready')

      await tick()
      // 核心断言：小引用不得调模型！
      expect(generateCalled).toBe(0)
    })

    it('When 整体引用超出预算需 B 时 Then 触发后台摘要并进入 running', async () => {
      let generateCalled = 0
      // 构造超长大消息
      const largeContent = '超长对话历史内容 '.repeat(10000)
      let finish: (text: string | null) => void = () => {}

      const deps: BackgroundSummaryDeps = {
        namespace: crypto.randomUUID(),
        getMessages: () => [{ id: 'm1', role: 'user', content: largeContent }],
        loadSummary: () => null,
        generate: () => {
          generateCalled++
          return new Promise<string | null>((resolve) => { finish = resolve })
        },
        // 模拟较小预算窗口（例如 10,000 tokens 预算）使得 largeContent 远超预算
        inferBudgetWindow: () => 10_000,
        budgetRatio: 0.35,
      }

      const result = reconcileReferenceSummaries('target-session', [refB], 'channel', 'model', deps)
      expect(result[refB.refId]).toContain('running')

      await tick()
      expect(generateCalled).toBe(1)

      finish('ready summary')
      await tick()

      const updated = reconcileReferenceSummaries('target-session', [refB], 'channel', 'model', deps)
      expect(updated[refB.refId]).toBe('ready')
    })

    it('When 预算发生变化（从 A 变为 B） Then 立即触发后台模型摘要', async () => {
      let generateCalled = 0
      const mediumContent = '中等长度对话内容 '.repeat(500) // ~5000 tokens

      const deps: BackgroundSummaryDeps = {
        namespace: crypto.randomUUID(),
        getMessages: () => [{ id: 'm1', role: 'user', content: mediumContent }],
        loadSummary: () => null,
        generate: async () => {
          generateCalled++
          return 'summary after budget change'
        },
        inferBudgetWindow: (m) => (m === 'huge-model' ? 200_000 : 8_000),
      }

      // 阶段 1：使用 huge-model，预算充裕（200k * 0.35 = 70k），走 Tier A
      const step1 = reconcileReferenceSummaries('target-session', [refA], 'channel', 'huge-model', deps)
      expect(step1[refA.refId]).toBe('ready')
      await tick()
      expect(generateCalled).toBe(0)

      // 阶段 2：切换为 small-model，预算变小（8k * 0.35 = 2.8k），超预算触发 Tier B
      const step2 = reconcileReferenceSummaries('target-session', [refA], 'channel', 'small-model', deps)
      expect(step2[refA.refId]).toContain('running')
      await tick()
      expect(generateCalled).toBe(1)
    })
  })

  describe('Rule 2: 全局并发上限控制（并发 2）与取消释放槽位', () => {
    it('When 同时存在 5 个需摘要引用时 Then 全局并发峰值不超过 2，完成与取消释放槽位按序接力', async () => {
      let activeConcurrency = 0
      let peakConcurrency = 0
      const finishFns: Array<() => void> = []

      const refs: AgentContextRef[] = [1, 2, 3, 4, 5].map((i) => ({
        refId: `ref_${i}`,
        sourceConversationId: `source_${i}`,
        sourceProjectId: 'fixture',
        titleAtAttach: `Ref ${i}`,
        mode: 'live',
      }))

      const deps: BackgroundSummaryDeps = fixture({
        maxConcurrency: 2,
        generate: () => {
          activeConcurrency++
          if (activeConcurrency > peakConcurrency) peakConcurrency = activeConcurrency
          return new Promise<string | null>((resolve) => {
            finishFns.push(() => {
              activeConcurrency--
              resolve('summary')
            })
          })
        },
      })

      // 调度 5 个引用
      reconcileReferenceSummaries('target-concurrent', refs, 'channel', 'model', deps)
      await tick()

      // 并发峰值不超过 2
      expect(peakConcurrency).toBe(2)
      expect(activeConcurrency).toBe(2)

      // 完成一个，立即接力启动第 3 个
      finishFns[0]!()
      await tick()
      expect(activeConcurrency).toBe(2)
      expect(peakConcurrency).toBe(2)

      // 取消剩余全部引用（模拟用户关闭或清空引用）：必须立即释放槽位
      reconcileReferenceSummaries('target-concurrent', [], 'channel', 'model', deps)
      await tick()
      expect(getActiveSummaryConcurrency()).toBe(0)
    })
  })

  describe('Rule 3: 单引用最大块数封顶（64块）超上限 fallback', () => {
    it('When 消息分块数超过单引用最大限制 (64块) Then 超上限必须 fallback 而非假完整 ready', async () => {
      let generateCalled = 0
      // 构造超过 64 块的消息列表（每块 10 条，65 块 = 650 条）
      const massiveMessages = Array.from({ length: 650 }, (_, i) => ({
        id: `msg_${i}`,
        role: 'user' as const,
        content: `消息条目 ${i}`,
      }))

      const deps: BackgroundSummaryDeps = fixture({
        chunkSize: 10,
        maxChunksPerRef: 64,
        getMessages: () => massiveMessages,
        generate: async () => {
          generateCalled++
          return 'fake-summary'
        },
      })

      const result = reconcileReferenceSummaries('target-cap', [refB], 'channel', 'model', deps)
      // 核心断言：超上限必须 fallback 而非假完整 ready！
      expect(result[refB.refId]).toBe('fallback')
      expect(result.summaryStatuses[refB.refId]).toBe('fallback')
      await tick()
      expect(generateCalled).toBe(0) // 不调用模型浪费 token
    })
  })

  describe('Rule 4: 真实进度 x/y 报告与四层类型结构', () => {
    it('When 多块任务处理中 Then 提供真实 progress { completed, total } 与 running:x/y 状态', async () => {
      // 3 块消息
      const messages = Array.from({ length: 30 }, (_, i) => ({
        id: `msg_${i}`,
        role: 'user' as const,
        content: `内容 ${i}`,
      }))

      let reportProgress: ((p: { completed: number; total: number }) => void) | undefined
      let finishTask: () => void = () => {}

      const deps: BackgroundSummaryDeps = fixture({
        chunkSize: 10,
        getMessages: () => messages,
        generate: (input) => {
          reportProgress = input.onProgress
          return new Promise((resolve) => {
            finishTask = () => resolve('summary')
          })
        },
      })

      const res1 = reconcileReferenceSummaries('target-progress', [refB], 'channel', 'model', deps)
      expect(res1.summaryProgresses[refB.refId]).toBeDefined()
      expect(res1.summaryProgresses[refB.refId]?.total).toBe(3)
      expect(res1.summaryProgresses[refB.refId]?.completed).toBe(0)

      await tick()
      // 模拟第 1 块完成
      reportProgress?.({ completed: 1, total: 3 })
      const res2 = reconcileReferenceSummaries('target-progress', [refB], 'channel', 'model', deps)
      expect(res2.summaryProgresses[refB.refId]?.completed).toBe(1)
      expect(res2[refB.refId]).toBe('running:1/3')

      // 模拟全部完成
      finishTask()
      await tick()
      const res3 = reconcileReferenceSummaries('target-progress', [refB], 'channel', 'model', deps)
      expect(res3[refB.refId]).toBe('ready')
      expect(res3.summaryProgresses[refB.refId]?.completed).toBe(3)
    })
  })

  describe('Rule 5: 失败回退与持久缓存重开', () => {
    it('When 模型调用失败 Then 标记失败回退而不泄漏异常正文', async () => {
      const deps: BackgroundSummaryDeps = fixture({
        generate: async () => { throw new Error('secret-error-canary') },
      })
      reconcileReferenceSummaries('target-fail', [refB], 'channel', 'model', deps)
      await tick()
      const res = reconcileReferenceSummaries('target-fail', [refB], 'channel', 'model', deps)
      expect(res[refB.refId]).toBe('fallback')
    })

    it('When 会话重开且持久缓存已命中 Then 直接 ready 且不重复生成', () => {
      let generated = false
      const deps: BackgroundSummaryDeps = fixture({
        loadSummary: () => 'persisted clean summary',
        generate: async () => { generated = true; return null },
      })
      const res = reconcileReferenceSummaries('target-cache', [refB], 'channel', 'model', deps)
      expect(res[refB.refId]).toBe('ready')
      expect(generated).toBe(false)
    })
  })
})
