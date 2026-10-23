import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setConfigHomeForTest } from '../config-paths'
import { writeJsonFileAtomic, writeTextFileAtomic } from '../safe-file'
import { reconcileReferenceSummaries } from './background-summary'
import { CHUNK_SUMMARY_PROMPT, getOrGenerateConversationSummary } from './summary-service'
import {
  computeSummaryHash, computeChunkHash, SUMMARY_SCHEMA_VERSION, SUMMARY_FALLBACK_PREFIX,
  getSummaryCacheFilePath, loadSummaryFromCache, isFallbackSummary,
  getChunkSummaryCacheFilePath, loadChunkSummaryFromCache,
} from './ref-cache'
import type { AgentContextRef } from '@gamma/shared'
import type { NormalizedReferencedMessage } from './context-builder'

let previousHome: string | undefined
beforeAll(() => { previousHome = setConfigHomeForTest(mkdtempSync(join(tmpdir(), 'gamma-summary-contract-'))) })
afterAll(() => { setConfigHomeForTest(previousHome) })

const messages: NormalizedReferencedMessage[] = Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `隔离合成消息${i}` }))

describe('Given 分块摘要缓存的版本、归属和质量契约', () => {
  test('When 分块边界/源/字段内容改变 Then 整体有序块列表哈希改变，未变块哈希稳定', () => {
    const hash = computeSummaryHash('source', messages)
    expect(hash).toBe(computeSummaryHash('source', [...messages]))
    expect(hash).not.toBe(computeSummaryHash('other', messages))
    expect(hash).not.toBe(computeSummaryHash('source', messages, 7))
    const appended = [...messages, { id: 'm21', role: 'user' as const, content: '新增尾块' }]
    expect(hash).not.toBe(computeSummaryHash('source', appended))
    expect(computeChunkHash('source', 0, messages.slice(0, 10))).toBe(computeChunkHash('source', 0, appended.slice(0, 10)))
    const toolA = [{ id: 'same', role: 'user' as const, content: '', toolCalls: [{ name: 'b:c', keyParam: 'd', resultSummary: 'e' }] }]
    const toolB = [{ id: 'same', role: 'user' as const, content: '', toolCalls: [{ name: 'b', keyParam: 'c:d', resultSummary: 'e' }] }]
    expect(computeSummaryHash('source', toolA)).not.toBe(computeSummaryHash('source', toolB))
    expect(() => computeSummaryHash('source', messages, 0)).toThrow('正整数')
  })

  test('When payload归属/边界/hash/schema不符 Then 不接受合法路径中的伪造整体缓存', () => {
    const hash = computeSummaryHash('source', messages)
    const path = getSummaryCacheFilePath('source', 'm20', hash)
    const valid = { sourceConversationId: 'source', snapshotUpToMessageId: 'm20', contentHash: hash, version: SUMMARY_SCHEMA_VERSION, createdAt: Date.now(), summary: '合成全量摘要' }
    for (const mismatch of [{ sourceConversationId: 'other' }, { snapshotUpToMessageId: 'other' }, { contentHash: 'other' }, { version: 'v1' }, { quality: 'unknown' }]) {
      writeJsonFileAtomic(path, { ...valid, ...mismatch })
      expect(loadSummaryFromCache('source', 'm20', hash)).toBeNull()
    }
    writeJsonFileAtomic(path, valid)
    expect(loadSummaryFromCache('source', 'm20', hash)).toBe('合成全量摘要')
    const chunkPath = getChunkSummaryCacheFilePath('source', 'chunk')
    writeJsonFileAtomic(chunkPath, { sourceConversationId: 'source', chunkHash: 'chunk', chunkIndex: 0, version: 'v1', createdAt: Date.now(), summary: '旧块' })
    expect(loadChunkSummaryFromCache('source', 'chunk')).toBeNull()
  })

  test('When JSON损坏 Then parser正文片段不进入日志', () => {
    const marker = 'SYNTHETIC_PRIVATE_CACHE_CANARY'
    const warnings: string[] = []
    const warn = console.warn
    writeTextFileAtomic(getChunkSummaryCacheFilePath('log_source', 'log_hash'), marker)
    writeTextFileAtomic(getSummaryCacheFilePath('log_source', 'm', 'log_hash'), marker)
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
    try {
      expect(loadChunkSummaryFromCache('log_source', 'log_hash')).toBeNull()
      expect(loadSummaryFromCache('log_source', 'm', 'log_hash')).toBeNull()
    } finally { console.warn = warn }
    expect(warnings.length).toBe(2)
    expect(warnings.join('\n')).not.toContain(marker)
  })

  test('When 分块失败仅头尾回退成功 Then 状态与重开仍为fallback，恢复后重新生成完整摘要', async () => {
    const ref: AgentContextRef = { refId: 'ref_quality', sourceConversationId: 'quality_source', sourceProjectId: 'p', titleAtAttach: '合成源', mode: 'snapshot', snapshotUpToMessageId: 'm20', snapshotAt: Date.now(), messageCount: messages.length }
    let calls = 0
    const generate = (input: Parameters<typeof getOrGenerateConversationSummary>[0]) => getOrGenerateConversationSummary({ ...input, deps: { generateText: async ({ prompt }) => { calls++; if (prompt.includes(CHUNK_SUMMARY_PROMPT)) throw new Error('合成分块失败'); return '合成头尾回退摘要' } } })
    const deps = { namespace: 'quality_first', forceTier: 'B' as const, getMessages: () => messages, generate }
    reconcileReferenceSummaries('target', [ref], 'test_channel', 'test_model', deps)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(reconcileReferenceSummaries('target', [ref], 'test_channel', 'test_model', deps)[ref.refId]).toBe('fallback')
    expect(calls).toBe(2)
    const hash = computeSummaryHash(ref.sourceConversationId, messages)
    expect(loadSummaryFromCache(ref.sourceConversationId, 'm20', hash)).toContain(SUMMARY_FALLBACK_PREFIX)
    let reopenCalls = 0
    const reopened = { namespace: 'quality_reopen', forceTier: 'B' as const, getMessages: () => messages, generate: async () => { reopenCalls++; return null } }
    expect(reconcileReferenceSummaries('target', [ref], 'test_channel', 'test_model', reopened)[ref.refId]).toBe('fallback')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(reopenCalls).toBe(1)
    expect(reconcileReferenceSummaries('target', [ref], 'test_channel', 'test_model', reopened)[ref.refId]).toBe('fallback')
    let recoveredCalls = 0
    const result = await getOrGenerateConversationSummary({ sourceConversationId: ref.sourceConversationId, snapshotUpToMessageId: 'm20', messages, channelId: 'test_channel', modelId: 'test_model', deps: { generateText: async () => { recoveredCalls++; return '合成完整摘要' } } })
    expect(recoveredCalls).toBe(4)
    expect(result).toBe('合成完整摘要')
    expect(isFallbackSummary(loadSummaryFromCache(ref.sourceConversationId, 'm20', hash)!)).toBe(false)
    const third = { namespace: 'quality_complete', getMessages: () => messages, generate: async () => { throw new Error('完整缓存不应重新生成') } }
    expect(reconcileReferenceSummaries('target', [ref], 'test_channel', 'test_model', third)[ref.refId]).toBe('ready')
    for (const entry of [deps, reopened, third]) reconcileReferenceSummaries('target', [], undefined, undefined, entry)
  })
})
