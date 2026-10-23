import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setConfigHomeForTest } from '../config-paths'
import {
  computeSnapshotHash,
  loadSnapshotFromCache,
  loadSummaryFromCache,
  saveSnapshotToCache,
  saveSummaryToCache,
  type CachedConversationSnapshot,
  type CachedConversationSummary,
} from './ref-cache'
import type { NormalizedReferencedMessage } from './context-builder'

describe('Conversation Reference Cache (Snapshots & Summaries)', () => {
  let tempHome: string
  let prevHome: string | undefined

  beforeAll(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'gamma-cache-test-'))
    prevHome = setConfigHomeForTest(tempHome)
  })

  afterAll(() => {
    setConfigHomeForTest(prevHome)
    try {
      rmSync(tempHome, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('computes deterministic SHA-256 hash from normalized messages', () => {
    const messages: NormalizedReferencedMessage[] = [
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm2', role: 'assistant', content: 'world', toolCalls: [{ name: 'read_file', keyParam: 'file.txt' }] },
    ]
    const hash1 = computeSnapshotHash(messages)
    const hash2 = computeSnapshotHash(messages)
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(32)

    // Different content produces different hash
    const hash3 = computeSnapshotHash([
      { id: 'm1', role: 'user', content: 'hello changed' },
    ])
    expect(hash3).not.toBe(hash1)
  })

  it('saves and loads normalized snapshots with atomic consistency', () => {
    const snapshot: CachedConversationSnapshot = {
      refId: 'ref_test_1',
      sourceConversationId: 'sess_123',
      sourceProjectId: 'proj_abc',
      title: 'Session 123 Architecture',
      snapshotUpToMessageId: 'msg_99',
      snapshotAt: 1700000000000,
      messageCount: 5,
      estTokens: 420,
      contentHash: 'hash1234567890abcdef',
      messages: [
        { id: 'm1', role: 'user', content: 'What is the plan?' },
        { id: 'msg_99', role: 'assistant', content: 'The plan is finalized.' },
      ],
      previousReferencedTitles: ['Prior Notes'],
    }

    snapshot.contentHash = computeSnapshotHash(snapshot.messages)
    saveSnapshotToCache(snapshot)
    const loaded = loadSnapshotFromCache('ref_test_1', 'msg_99')

    expect(loaded).not.toBeNull()
    expect(loaded!.refId).toBe('ref_test_1')
    expect(loaded!.title).toBe('Session 123 Architecture')
    expect(loaded!.snapshotUpToMessageId).toBe('msg_99')
    expect(loaded!.messages.length).toBe(2)
    expect(loaded!.messages[1]!.content).toBe('The plan is finalized.')
  })

  it('returns null when snapshot does not exist', () => {
    const nonExistent = loadSnapshotFromCache('non_existent', 'msg_none')
    expect(nonExistent).toBeNull()
  })

  it('saves and loads structured summaries atomically', () => {
    const summary: CachedConversationSummary = {
      sourceConversationId: 'sess_456',
      snapshotUpToMessageId: 'msg_10',
      contentHash: 'hash_abc',
      version: 'v1',
      createdAt: 1700000001000,
      summary: '【目标】重构缓存\n【关键结论】使用原子文件写入\n【重要决定】无需外部数据库',
    }

    saveSummaryToCache(summary)
    const loaded = loadSummaryFromCache('sess_456', 'msg_10', 'hash_abc')

    expect(loaded).not.toBeNull()
    expect(loaded).toContain('【目标】重构缓存')
    expect(loaded).toContain('【关键结论】使用原子文件写入')
  })

  it('returns null on cache miss for summaries', () => {
    const missing = loadSummaryFromCache('sess_missing', 'msg_0', 'no_hash')
    expect(missing).toBeNull()
  })
})
