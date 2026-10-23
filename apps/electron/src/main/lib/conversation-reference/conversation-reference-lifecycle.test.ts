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
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
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
import { getReferencedMessagesForRef } from './pi-tools'
import { getSnapshotCacheFilePathByRefId } from './ref-cache'
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

  function ref(sourceConversationId: string, mode: 'live' | 'snapshot' = 'snapshot'): AgentContextRef {
    return { refId: 'renderer-forged-id', sourceConversationId, sourceProjectId: 'forged-project', titleAtAttach: 'forged-title', mode, snapshotUpToMessageId: 'forged-cutoff' }
  }

  describe('权威持久化与约束', () => {
    it('最多5个并由main生成唯一ID，忽略renderer伪造元数据', async () => {
      const target = await createAgentSession('Target')
      const sources = await Promise.all(Array.from({ length: 8 }, (_, i) => createAgentSession(`Source ${i}`)))
      const updated = updateAgentContextRefs(target.id, sources.map((s) => ref(s.id)))
      expect(updated).toHaveLength(5)
      expect(new Set(updated.map((r) => r.refId)).size).toBe(5)
      expect(updated[0]?.refId).not.toBe('renderer-forged-id')
      expect(updated[0]?.titleAtAttach).toBe('Source 0')
      expect(updated[0]?.sourceProjectId).not.toBe('forged-project')
      expect(updated[0]?.snapshotUpToMessageId).toBeUndefined()
    })
    it('去重、禁止自引用，并拒绝不存在/穿越源与非法模式', async () => {
      const target = await createAgentSession('Target'), source = await createAgentSession('Source')
      expect(updateAgentContextRefs(target.id, [ref(target.id), ref(source.id), ref(source.id)])).toHaveLength(1)
      expect(() => updateAgentContextRefs(target.id, [ref('missing')])).toThrow()
      expect(() => updateAgentContextRefs(target.id, [ref('../escape')])).toThrow()
      expect(() => updateAgentContextRefs(target.id, [{ ...ref(source.id), mode: 'evil' } as unknown as AgentContextRef])).toThrow()
    })
    it('从磁盘重读保持引用，live切snapshot在切换时冻结，缓存丢失不重建', async () => {
      const target = await createAgentSession('Target'), source = await createAgentSession('Source')
      const user = (id: string, text: string): SDKMessage => ({ type: 'user', uuid: id, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } })
      appendSDKMessages(source.id, [user('m1', 'old')])
      const live = updateAgentContextRefs(target.id, [ref(source.id, 'live')])[0]!
      appendSDKMessages(source.id, [user('m2', 'new')])
      const frozen = updateAgentContextRefs(target.id, [{ ...live, mode: 'snapshot' }])[0]!
      expect(frozen.refId).not.toBe(live.refId)
      expect(frozen.snapshotUpToMessageId).toBe('m2')
      const disk = JSON.parse(readFileSync(getAgentSessionsIndexPath(), 'utf8')) as { sessions: Array<{ id: string; contextRefs: AgentContextRef[] }> }
      expect(disk.sessions.find((s) => s.id === target.id)?.contextRefs).toEqual([frozen])
      const before = JSON.stringify(getReferencedMessagesForRef(frozen))
      appendSDKMessages(source.id, [user('m3', 'later')])
      expect(JSON.stringify(getReferencedMessagesForRef(frozen))).toBe(before)
      unlinkSync(getSnapshotCacheFilePathByRefId(frozen.refId))
      expect(getReferencedMessagesForRef(frozen)).toEqual([])
      expect(updateAgentContextRefs(target.id, [])).toEqual([])
    })
    it('live仅读取完整消息，尾部系统事件不能把非空partial伪装成完整', async () => {
      const target = await createAgentSession('Target'), source = await createAgentSession('Source')
      appendSDKMessages(source.id, [
        { type: 'user', uuid: 'u1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'question' }] } },
        { type: 'assistant', uuid: 'a1', parent_tool_use_id: null, message: { stop_reason: 'stop', content: [{ type: 'text', text: 'complete' }] } },
        { type: 'assistant', uuid: 'partial', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'still streaming' }] } },
        { type: 'system', subtype: 'compact_boundary', uuid: 'system1' } as unknown as SDKMessage,
      ])
      const live = updateAgentContextRefs(target.id, [ref(source.id, 'live')])[0]!
      expect(getReferencedMessagesForRef(live).map((m) => m.id)).toEqual(['u1', 'a1'])
      const frozen = updateAgentContextRefs(target.id, [{ ...live, mode: 'snapshot' }])[0]!
      expect(frozen.snapshotUpToMessageId).toBe('a1')
      expect(getReferencedMessagesForRef(frozen).map((m) => m.id)).toEqual(['u1', 'a1'])
    })
    it('移除再附加生成新快照，不与同一源截止点旧内容混淆', async () => {
      const target = await createAgentSession('Target'), source = await createAgentSession('Source')
      appendSDKMessages(source.id, [{ type: 'user', uuid: 'm1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'first' }] } }])
      const first = updateAgentContextRefs(target.id, [ref(source.id)])[0]!
      updateAgentContextRefs(target.id, [])
      const second = updateAgentContextRefs(target.id, [ref(source.id)])[0]!
      expect(second.refId).not.toBe(first.refId)
      expect(getReferencedMessagesForRef(second)).toHaveLength(1)
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
          stop_reason: 'end_turn',
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

    it('BDD反例: 附加时立即冻结快照，后续源会话被编辑或追加新消息时快照内容绝对字节稳定', async () => {
      const sourceSession = await createAgentSession('Stable Source')
      const targetSession = await createAgentSession('Target With Snapshot')

      // 在源会话中写入初始消息
      const msg1: SDKMessage = {
        id: 'msg_initial_1',
        type: 'user',
        message: { content: [{ type: 'text', text: 'Original question before attach' }] },
      } as SDKMessage
      const msg2: SDKMessage = {
        id: 'msg_initial_2',
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Original response before attach' }],
          stop_reason: 'end_turn',
        },
      } as SDKMessage
      appendSDKMessages(sourceSession.id, [msg1, msg2])

      // 附加引用（快照模式）
      const updatedRefs = updateAgentContextRefs(targetSession.id, [
        {
          refId: '',
          sourceConversationId: sourceSession.id,
          sourceProjectId: '',
          titleAtAttach: '',
          mode: 'snapshot',
        },
      ])

      expect(updatedRefs.length).toBe(1)
      const attachedRef = updatedRefs[0]!
      expect(attachedRef.snapshotUpToMessageId).toBe('msg_initial_2')
      expect(attachedRef.messageCount).toBe(2)

      // 此时读取快照
      const snapshotBefore = getReferencedMessagesForRef(attachedRef)
      expect(snapshotBefore.length).toBe(2)
      expect(snapshotBefore[1]?.content).toContain('Original response before attach')

      // 核心验证：源会话随后追加新消息或被修改
      const msg3: SDKMessage = {
        id: 'msg_post_attach',
        type: 'user',
        message: { content: [{ type: 'text', text: 'New question added AFTER attach' }] },
      } as SDKMessage
      const msg4: SDKMessage = {
        id: 'msg_post_attach_2',
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'New secret response' }], stop_reason: 'end_turn' },
      } as SDKMessage
      appendSDKMessages(sourceSession.id, [msg3, msg4])

      // 再次读取该引用的快照消息：必须保持冻结时的 2 条消息，绝对不能读到附加后的新消息！
      const snapshotAfter = getReferencedMessagesForRef(attachedRef)
      expect(snapshotAfter.length).toBe(2)
      expect(snapshotAfter.map((m) => m.id)).toEqual(['msg_initial_1', 'msg_initial_2'])
      expect(JSON.stringify(snapshotAfter)).toBe(JSON.stringify(snapshotBefore))
      expect(JSON.stringify(snapshotAfter)).not.toContain('New question added AFTER attach')
      expect(JSON.stringify(snapshotAfter)).not.toContain('New secret response')
    })

    it('BDD反例: 通用 updateAgentSessionMeta 严禁绕过 contextRefs 权威管理', async () => {
      const targetSession = await createAgentSession('Bypass Test Session')

      // 尝试通过 updateAgentSessionMeta 注入非法的 contextRefs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateAgentSessionMeta(targetSession.id, {
        title: 'Updated Title',
        contextRefs: [
          {
            refId: 'ref_bypassed_malicious',
            sourceConversationId: 'foreign_session',
            sourceProjectId: 'fake_proj',
            titleAtAttach: 'Hacked',
            mode: 'snapshot',
          },
        ],
      } as unknown as Parameters<typeof updateAgentSessionMeta>[1])

      // 验证通用更新生效了 title，但 contextRefs 绝未被绕过写入
      const meta = getAgentSessionMeta(targetSession.id)
      expect(meta?.title).toBe('Updated Title')
      expect(meta?.contextRefs).toBeUndefined()
    })

    it('BDD反例: 末尾生成中的未结束 assistant (无 stop_reason) 绝不计入完整消息快照', async () => {
      const sourceSession = await createAgentSession('Streaming Source')

      const msg1: SDKMessage = {
        id: 'user_1',
        type: 'user',
        message: { content: [{ type: 'text', text: 'Please generate code' }] },
      } as SDKMessage
      const msg2Complete: SDKMessage = {
        id: 'asst_tool_call',
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Calling tool' },
            { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls' } },
          ],
          stop_reason: 'tool_use', // 完整工具调用
        },
      } as SDKMessage
      const msg3StreamingIncomplete: SDKMessage = {
        id: 'asst_streaming',
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Partial text being streamed right now...' }],
          // 关键：正在生成中，stop_reason 为 undefined/null
          stop_reason: undefined,
        },
      } as SDKMessage

      appendSDKMessages(sourceSession.id, [msg1, msg2Complete, msg3StreamingIncomplete])

      // 获取详情：最后完整消息 ID 必须是 msg2Complete，不应包含未完成的 msg3
      const detail = getAgentContextRefDetail(sourceSession.id)
      expect(detail.lastCompleteMessageId).toBe('asst_tool_call')
      expect(detail.messageCount).toBe(2) // 仅 user_1 和 asst_tool_call
    })

    it('BDD反例: 已删除源的引用允许被用户安全移除', async () => {
      const sourceSession = await createAgentSession('To Delete')
      const targetSession = await createAgentSession('Target Holder')

      const updated = updateAgentContextRefs(targetSession.id, [
        {
          refId: '',
          sourceConversationId: sourceSession.id,
          sourceProjectId: '',
          titleAtAttach: 'Will be deleted',
          mode: 'snapshot',
        },
      ])
      expect(updated.length).toBe(1)
      const refId = updated[0]!.refId

      // 物理删除源会话
      await deleteAgentSession(sourceSession.id)

      // 用户在 UI 上将该已失效引用移除
      const afterRemoval = updateAgentContextRefs(targetSession.id, [])
      expect(afterRemoval.length).toBe(0)

      const reloaded = getAgentContextRefs(targetSession.id)
      expect(reloaded.length).toBe(0)
    })
  })
})
