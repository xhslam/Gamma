import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setConfigHomeForTest, getAgentSessionsIndexPath, getAgentSessionMessagesPath } from '../config-paths'
import { getAgentSessionMeta } from '../agent-session-manager'
import {
  createConversationReferenceExtension,
  getReferencedMessagesForRef,
  normalizeSDKMessage,
  validateAndFindRef,
} from './pi-tools'
import { saveSnapshotToCache, computeSnapshotHash } from './ref-cache'
import type { AgentContextRef, SDKMessage } from '@gamma/shared'

describe('Conversation Reference Pi Extension Tools & Security', () => {
  let tempHome: string
  let prevHome: string | undefined

  const currentSessionId = 'current_session_1'
  const sourceSessionId = 'source_session_1'
  const deepSourceSessionId = 'deep_source_session'

  beforeAll(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'gamma-pi-tools-test-'))
    prevHome = setConfigHomeForTest(tempHome)

    // 初始化会话元数据索引文件
    const indexPath = getAgentSessionsIndexPath()
    const indexData = {
      version: 1,
      sessions: [
        {
          id: currentSessionId,
          title: 'Current Session',
          workspaceId: 'ws_main',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          contextRefs: [
            {
              refId: 'ref_source_1',
              sourceConversationId: sourceSessionId,
              sourceProjectId: 'ws_other',
              titleAtAttach: 'Source Conversation 1',
              mode: 'snapshot' as const,
              snapshotUpToMessageId: 'msg_2',
              snapshotAt: Date.now(),
              messageCount: 3,
            },
            {
              refId: 'ref_deep',
              sourceConversationId: deepSourceSessionId,
              sourceProjectId: 'ws_deep',
              titleAtAttach: 'Deep 300 Session',
              mode: 'snapshot' as const,
              snapshotUpToMessageId: 'msg_deep_290',
              snapshotAt: Date.now(),
              messageCount: 300,
            },
          ],
        },
        {
          id: sourceSessionId,
          title: 'Source Conversation 1',
          workspaceId: 'ws_other',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: deepSourceSessionId,
          title: 'Deep 300 Session',
          workspaceId: 'ws_deep',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }
    writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

    // 写入 sourceSessionId 的 JSONL 消息（包含超出快照的第四条消息 msg_3）
    const sourceMessagesPath = getAgentSessionMessagesPath(sourceSessionId)
    const sourceMessages: SDKMessage[] = [
      { id: 'msg_0', type: 'user', message: { role: 'user', content: 'What is our deployment strategy?' } } as SDKMessage,
      {
        id: 'msg_1',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'We use Docker and Kubernetes.' },
            { type: 'tool_use', name: 'read_config', input: { path: 'deploy.yaml' } },
          ],
        },
      } as SDKMessage,
      { id: 'msg_2', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All pods configured.' }] } } as SDKMessage,
      // 本条消息在 snapshot 截止点 msg_2 之后添加，快照模式绝对不能读取到它！
      { id: 'msg_3', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Secret leaked after snapshot.' }] } } as SDKMessage,
    ]
    writeFileSync(sourceMessagesPath, sourceMessages.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf-8')

    // 写入 deepSourceSessionId 的 300 条消息
    const deepMessagesPath = getAgentSessionMessagesPath(deepSourceSessionId)
    const deepMessages: SDKMessage[] = []
    for (let i = 0; i < 300; i++) {
      let content = `Step ${i}: Processing data block number ${i}.`
      // 在第 250 条消息深处埋下特异暗号
      if (i === 250) {
        content = '特异暗号识别：青花瓷-7391，这是深处确凿事实。'
      }
      // 在第 295 条（快照 msg_deep_290 之后）埋入超出快照的内容
      if (i === 295) {
        content = '快照后追加暗号：红山玉-9999，不应被快照工具检索到。'
      }
      deepMessages.push({
        id: `msg_deep_${i}`,
        type: i % 2 === 0 ? 'user' : 'assistant',
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: content }],
        },
      } as SDKMessage)
    }
    writeFileSync(deepMessagesPath, deepMessages.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf-8')
    // 附加阶段已冻结的真实缓存；读取阶段不允许从源重建。
    for (const r of indexData.sessions[0]!.contextRefs ?? []) {
      const all = r.sourceConversationId === sourceSessionId ? sourceMessages : deepMessages
      const cutoff = all.findIndex((m) => (m as unknown as { id: string }).id === r.snapshotUpToMessageId)
      const messages = all.slice(0, cutoff + 1).map(normalizeSDKMessage).filter((m): m is NonNullable<typeof m> => m !== null)
      saveSnapshotToCache({ ...r, title: r.titleAtAttach, estTokens: 100, contentHash: computeSnapshotHash(messages), messages })
    }
  })

  afterAll(() => {
    setConfigHomeForTest(prevHome)
    try {
      rmSync(tempHome, { recursive: true, force: true })
    } catch {
      // cleanup ignored
    }
  })

  describe('normalizeSDKMessage', () => {
    it('normalizes user messages and strips thinking/base64', () => {
      const sdkUser: SDKMessage = {
        id: 'u1',
        type: 'user',
        message: {
          role: 'user',
          content: 'Hello <thinking>internal thought</thinking> and data:image/png;base64,AAAA end',
        },
      } as SDKMessage
      const norm = normalizeSDKMessage(sdkUser)
      expect(norm).not.toBeNull()
      expect(norm!.role).toBe('user')
      expect(norm!.content).not.toContain('internal thought')
      expect(norm!.content).toContain('[base64 data omitted]')
      expect(norm!.content).toContain('Hello')
    })

    it('BDD反例: 正确解析真实 SDK tool_result 形状（在 user.message.content 数组中）及附件元数据', () => {
      const sdkUserToolResult: SDKMessage = {
        uuid: 'u2',
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01ABC',
              content: 'Successfully executed migration on database with 42 tables created.',
              is_error: false,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAA=',
              },
            },
          ],
        },
      } as unknown as SDKMessage

      const norm = normalizeSDKMessage(sdkUserToolResult)
      expect(norm).not.toBeNull()
      // 提取了 tool_result 块
      expect(norm!.toolCalls?.length).toBe(1)
      expect(norm!.toolCalls?.[0]?.name).toBe('toolu_01ABC')
      expect(norm!.toolCalls?.[0]?.resultSummary).toContain('Successfully executed migration')
      // 提取了附件元数据并剥离了 base64 数据
      expect(norm!.attachments?.length).toBe(1)
      expect(norm!.attachments?.[0]?.type).toBe('image/png')
      expect(JSON.stringify(norm)).not.toContain('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAA=')
    })
  })

  describe('Security & Whitelist Validation (validateAndFindRef)', () => {
    it('succeeds for authorized refId in current session contextRefs', () => {
      const res = validateAndFindRef(currentSessionId, 'ref_source_1')
      expect('ref' in res).toBe(true)
      if ('ref' in res) {
        expect(res.ref.sourceConversationId).toBe(sourceSessionId)
      }
    })

    it('rejects refId not in current session whitelist (prevents unauthorized access)', () => {
      const res = validateAndFindRef(currentSessionId, 'unauthorized_ref')
      expect('error' in res).toBe(true)
      if ('error' in res) {
        expect(res.error).toContain('未授权的引用 ID 或该引用已被用户从本会话移除')
      }
    })

    it('rejects path traversal attempts in refId', () => {
      const traversal1 = validateAndFindRef(currentSessionId, '../../etc/passwd')
      expect('error' in traversal1).toBe(true)
      const traversal2 = validateAndFindRef(currentSessionId, 'ref/something')
      expect('error' in traversal2).toBe(true)
    })

    it('BDD反例: 严格核验 sourceProjectId 与源会话所属工作区，防止越权伪造', () => {
      const maliciousRef: AgentContextRef = {
        refId: 'ref_mismatch',
        sourceConversationId: sourceSessionId, // 真实 workspaceId 是 'ws_other'
        sourceProjectId: 'ws_attacker_fake',   // 伪造的 workspaceId
        titleAtAttach: 'Hacked',
        mode: 'snapshot',
      }
      // 临时注入到当前会话元数据中
      const meta = getAgentSessionMeta(currentSessionId)
      meta!.contextRefs!.push(maliciousRef)

      const res = validateAndFindRef(currentSessionId, 'ref_mismatch')
      expect('error' in res).toBe(true)
      if ('error' in res) {
        expect(res.error).toContain('引用项目归属异常')
      }
      meta!.contextRefs!.pop()
    })
  })

  describe('Snapshot Boundary Enforcement', () => {
    it('strictly does not reveal messages past snapshotUpToMessageId in snapshot mode', () => {
      const ref: AgentContextRef = {
        refId: 'ref_source_1',
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_other',
        titleAtAttach: 'Source Conversation 1',
        mode: 'snapshot',
        snapshotUpToMessageId: 'msg_2',
      }
      const messages = getReferencedMessagesForRef(ref)
      // Must contain msg_0, msg_1, msg_2 (3 messages), but NOT msg_3
      expect(messages.length).toBe(3)
      const ids = messages.map((m) => m.id)
      expect(ids).toContain('msg_0')
      expect(ids).toContain('msg_1')
      expect(ids).toContain('msg_2')
      expect(ids).not.toContain('msg_3')

      const allText = messages.map((m) => m.content).join(' ')
      expect(allText).not.toContain('Secret leaked after snapshot')
    })

    it('BDD反例: 快照缓存缺失且截止ID找不到时严格 Fail Closed，绝不泄露附加后消息', () => {
      const refMissingCutoff: AgentContextRef = {
        refId: 'ref_missing_cutoff',
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_other',
        titleAtAttach: 'Source Missing Cutoff',
        mode: 'snapshot',
        snapshotUpToMessageId: 'msg_non_existent_999', // 截止点在源会话不存在
      }

      const messages = getReferencedMessagesForRef(refMissingCutoff)
      // 必须 Fail Closed 返回空数组，绝不能因为找不到截止 ID 就回退返回源会话的所有实时消息！
      expect(messages.length).toBe(0)
    })

    it('BDD反例: 空快照（无截止ID）在快照模式下始终返回空', () => {
      const emptyRef: AgentContextRef = {
        refId: 'ref_empty_snapshot',
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_other',
        titleAtAttach: 'Empty Snapshot',
        mode: 'snapshot',
        snapshotUpToMessageId: undefined,
      }

      const messages = getReferencedMessagesForRef(emptyRef)
      expect(messages.length).toBe(0)
    })
  })

  describe('Pi Extension Tools Execution', () => {
    // 模拟 Pi 扩展注册并提取工具 execute 函数
    type RegisteredTool = {
      name: string
      execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
    }
    const tools = new Map<string, RegisteredTool>()
    const mockPi = {
      registerTool: (tool: RegisteredTool) => {
        tools.set(tool.name, tool)
      },
      on: () => {},
    }

    const extFactory = createConversationReferenceExtension(currentSessionId)
    extFactory(mockPi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI)

    it('registers list, read, and search tools', () => {
      expect(tools.has('list_referenced_conversations')).toBe(true)
      expect(tools.has('read_referenced_conversation')).toBe(true)
      expect(tools.has('search_referenced_conversation')).toBe(true)
    })

    it('list_referenced_conversations lists active refs', async () => {
      const listTool = tools.get('list_referenced_conversations')!
      const result = await listTool.execute('call_1', {})
      expect(result.content[0]!.text).toContain('ref_source_1')
      expect(result.content[0]!.text).toContain('Source Conversation 1')
      expect(result.content[0]!.text).toContain('ref_deep')
    })

    it('read_referenced_conversation paginates correctly with offset and limit', async () => {
      const readTool = tools.get('read_referenced_conversation')!
      const result = await readTool.execute('call_2', {
        id: 'ref_source_1',
        offset: 0,
        limit: 2,
      })
      expect(result.content[0]!.text).toContain('消息 0 至 1 / 共 3 条')
      expect(result.content[0]!.text).toContain('What is our deployment strategy?')
      expect(result.content[0]!.text).toContain('We use Docker and Kubernetes.')
      expect(result.content[0]!.text).not.toContain('Secret leaked after snapshot')
    })

    it('read_referenced_conversation rejects unauthorized refId', async () => {
      const readTool = tools.get('read_referenced_conversation')!
      const result = await readTool.execute('call_3', { id: 'ref_evil' })
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('未授权的引用 ID')
    })

    it('search_referenced_conversation locates deep fact in 300 messages with surrounding context', async () => {
      const searchTool = tools.get('search_referenced_conversation')!
      const result = await searchTool.execute('call_4', {
        id: 'ref_deep',
        query: '青花瓷-7391',
      })
      expect(result.isError).toBeFalsy()
      expect(result.content[0]!.text).toContain('青花瓷-7391')
      expect(result.content[0]!.text).toContain('消息 #250')
      // Surrounding context #249 and #251 should be present
      expect(result.content[0]!.text).toContain('#249')
      expect(result.content[0]!.text).toContain('#251')
    })

    it('search_referenced_conversation returns "引用的对话里没有提到" for missing facts', async () => {
      const searchTool = tools.get('search_referenced_conversation')!
      const result = await searchTool.execute('call_5', {
        id: 'ref_deep',
        query: '完全不存在的事实内容',
      })
      expect(result.content[0]!.text).toContain('引用的对话里没有提到关键词 "完全不存在的事实内容"')
    })

    it('search_referenced_conversation does NOT locate facts added after snapshot boundary', async () => {
      const searchTool = tools.get('search_referenced_conversation')!
      // '红山玉-9999' was at message #295, but snapshot was up to #290
      const result = await searchTool.execute('call_6', {
        id: 'ref_deep',
        query: '红山玉-9999',
      })
      expect(result.content[0]!.text).toContain('引用的对话里没有提到关键词 "红山玉-9999"')
    })
  })
})
