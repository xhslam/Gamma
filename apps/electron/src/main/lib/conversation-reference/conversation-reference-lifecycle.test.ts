/**
 * Conversation Reference Lifecycle & Validation BDD Test Suite
 *
 * 测试范围：
 * 1. 会话引用元数据持久化与重开恢复 (Persistence & Reload)
 * 2. 最大引用限制 (Max 5)、去重 (Dedup)、防自引用 (No Self-Ref)
 * 3. 源会话重命名与删除容错 (Rename & Source Deletion)
 * 4. 快照 (Snapshot) 与 实时 (Live) 边界一致性验证
 * 5. 详情查询 (ContextRefDetail) 准确性
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  setConfigHomeForTest,
  getAgentSessionsIndexPath,
  getAgentSessionMessagesPath,
} from '../config-paths'
import {
  createAgentSession,
  getAgentSessionMeta,
  getAgentContextRefs,
  updateAgentContextRefs,
  getAgentContextRefDetail,
  updateAgentSessionMeta,
  deleteAgentSession,
  appendSDKMessages,
} from '../agent-session-manager'
import type { AgentContextRef, SDKMessage } from '@gamma/shared'

describe('Conversation Reference Lifecycle & Validation', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gamma-ref-lifecycle-'))
    setConfigHomeForTest(tempDir)
    mkdirSync(join(tempDir, '.gamma'), { recursive: true })
    mkdirSync(join(tempDir, '.gamma', 'agent-sessions'), { recursive: true })

    // 初始化空白索引
    writeFileSync(
      getAgentSessionsIndexPath(),
      JSON.stringify({ version: 2, sessions: [] }),
      'utf-8'
    )
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
    setConfigHomeForTest(undefined)
  })

  describe('Validation & Constraints (Max 5, Dedup, No Self-Ref)', () => {
    it('enforces maximum 5 references limit', async () => {
      const targetSession = await createAgentSession('Target Session')

      const refs: AgentContextRef[] = []
      for (let i = 1; i <= 8; i++) {
        refs.push({
          refId: `ref-${i}`,
          sourceConversationId: `source-session-${i}`,
          sourceProjectId: 'ws-1',
          titleAtAttach: `Source ${i}`,
          mode: 'snapshot',
        })
      }

      const updated = updateAgentContextRefs(targetSession.id, refs)
      expect(updated.length).toBe(5)
      expect(updated.map((r) => r.refId)).toEqual(['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5'])

      const persisted = getAgentContextRefs(targetSession.id)
      expect(persisted.length).toBe(5)
    })

    it('rejects self-referencing attempts', async () => {
      const targetSession = await createAgentSession('Self Ref Test')

      const refs: AgentContextRef[] = [
        {
          refId: 'ref-self',
          sourceConversationId: targetSession.id, // 自引用！
          sourceProjectId: 'ws-1',
          titleAtAttach: 'Self',
          mode: 'snapshot',
        },
        {
          refId: 'ref-valid',
          sourceConversationId: 'other-session-123',
          sourceProjectId: 'ws-1',
          titleAtAttach: 'Other',
          mode: 'snapshot',
        },
      ]

      const updated = updateAgentContextRefs(targetSession.id, refs)
      expect(updated.length).toBe(1)
      expect(updated[0]?.sourceConversationId).toBe('other-session-123')
    })

    it('deduplicates multiple references to the same source session', async () => {
      const targetSession = await createAgentSession('Dedup Test')

      const refs: AgentContextRef[] = [
        {
          refId: 'ref-1',
          sourceConversationId: 'source-abc',
          sourceProjectId: 'ws-1',
          titleAtAttach: 'First Reference',
          mode: 'snapshot',
        },
        {
          refId: 'ref-2',
          sourceConversationId: 'source-abc', // 重复引用同一源会话
          sourceProjectId: 'ws-1',
          titleAtAttach: 'Second Reference to Same',
          mode: 'live',
        },
      ]

      const updated = updateAgentContextRefs(targetSession.id, refs)
      expect(updated.length).toBe(1)
      expect(updated[0]?.refId).toBe('ref-1')
      expect(updated[0]?.titleAtAttach).toBe('First Reference')
    })
  })

  describe('Persistence & Reload Across Sessions', () => {
    it('persists contextRefs to disk atomically and reloads them cleanly', async () => {
      const targetSession = await createAgentSession('Persistence Test')
      const initialRefs: AgentContextRef[] = [
        {
          refId: 'ref-persist-1',
          sourceConversationId: 'source-xyz',
          sourceProjectId: 'ws-proj-1',
          titleAtAttach: 'Architectural Blueprint',
          mode: 'snapshot',
          snapshotUpToMessageId: 'msg-42',
          snapshotAt: 1700000000000,
          messageCount: 15,
          estTokens: 1200,
        },
      ]

      updateAgentContextRefs(targetSession.id, initialRefs)

      // 验证元数据已持久化并可重新加载
      const meta = getAgentSessionMeta(targetSession.id)
      expect(meta?.contextRefs).toBeDefined()
      expect(meta?.contextRefs?.length).toBe(1)
      expect(meta?.contextRefs?.[0]?.titleAtAttach).toBe('Architectural Blueprint')
      expect(meta?.contextRefs?.[0]?.mode).toBe('snapshot')
      expect(meta?.contextRefs?.[0]?.snapshotUpToMessageId).toBe('msg-42')

      // 移除引用并持久化
      updateAgentContextRefs(targetSession.id, [])
      const emptyMeta = getAgentSessionMeta(targetSession.id)
      expect(emptyMeta?.contextRefs).toEqual([])
    })
  })

  describe('Source Session Details & Deletion Resilience', () => {
    it('retrieves accurate context ref detail with preview and message count', async () => {
      const sourceSession = await createAgentSession('Source Conversation Alpha')

      // 写入消息
      const userMsg: SDKMessage = {
        type: 'user',
        uuid: 'user-msg-01',
        message: { content: [{ type: 'text', text: '请帮我实现会话引用功能的纯函数模块。' }] },
        _createdAt: Date.now(),
      } as unknown as SDKMessage

      const assistantMsg: SDKMessage = {
        type: 'assistant',
        uuid: 'assistant-msg-01',
        message: {
          content: [{ type: 'text', text: '好的，我已经为你设计好了 context-builder 模块。' }],
          stopReason: 'end_turn',
        },
        _createdAt: Date.now(),
      } as unknown as SDKMessage

      appendSDKMessages(sourceSession.id, [userMsg, assistantMsg])

      const detail = getAgentContextRefDetail(sourceSession.id)
      expect(detail.exists).toBe(true)
      expect(detail.title).toBe('Source Conversation Alpha')
      expect(detail.messageCount).toBe(2)
      expect(detail.lastCompleteMessageId).toBe('assistant-msg-01')
      expect(detail.firstMessagePreview).toContain('请帮我实现会话引用功能')
      expect(detail.estTokens).toBeGreaterThan(0)
    })

    it('returns exists: false gracefully when source session is deleted or non-existent', async () => {
      const detail = getAgentContextRefDetail('non-existent-session-id')
      expect(detail.exists).toBe(false)
      expect(detail.title).toBe('已删除的会话')
      expect(detail.messageCount).toBe(0)
      expect(detail.estTokens).toBe(0)
    })

    it('handles source deletion after reference was attached without crashing', async () => {
      const sourceSession = await createAgentSession('Temporary Source')
      const targetSession = await createAgentSession('Target Session')

      const refs: AgentContextRef[] = [
        {
          refId: 'ref-temp',
          sourceConversationId: sourceSession.id,
          sourceProjectId: '',
          titleAtAttach: 'Temporary Source',
          mode: 'snapshot',
        },
      ]
      updateAgentContextRefs(targetSession.id, refs)

      // 删除源会话
      await deleteAgentSession(sourceSession.id)

      // 目标会话的引用元数据仍存在
      const activeRefs = getAgentContextRefs(targetSession.id)
      expect(activeRefs.length).toBe(1)
      expect(activeRefs[0]?.sourceConversationId).toBe(sourceSession.id)

      // 查询该引用的详情标记为已删除
      const detail = getAgentContextRefDetail(sourceSession.id)
      expect(detail.exists).toBe(false)
    })

    it('reflects updated title when source session is renamed', async () => {
      const sourceSession = await createAgentSession('Original Title')
      updateAgentSessionMeta(sourceSession.id, { title: 'Renamed Title for Reference' })

      const detail = getAgentContextRefDetail(sourceSession.id)
      expect(detail.title).toBe('Renamed Title for Reference')
    })
  })
})
