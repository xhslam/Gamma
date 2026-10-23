import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setConfigHomeForTest, getAgentSessionsIndexPath, getAgentSessionMessagesPath } from '../config-paths'
import {
  injectConversationReferencesContext,
  injectReferencedConversationsIntoMessages,
} from './context-injector'
import { updateAgentContextRefs } from '../agent-session-manager'
import { reconcileReferenceSummaries } from './background-summary'
import { saveSnapshotToCache, computeSnapshotHash, getSnapshotCacheFilePathByRefId } from './ref-cache'
import { normalizeSDKMessage } from './context-builder'
import type { SDKMessage } from '@gamma/shared'

describe('Conversation Reference Context Injector & Compaction Resilience', () => {
  let tempHome: string
  let prevHome: string | undefined

  const testSessionId = 'injector_test_session'
  const sourceSessionId = 'source_test_session'

  beforeAll(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'gamma-injector-test-'))
    prevHome = setConfigHomeForTest(tempHome)

    const indexPath = getAgentSessionsIndexPath()
    const indexData = {
      version: 1,
      sessions: [
        {
          id: testSessionId,
          title: 'Injector Test Session',
          workspaceId: 'ws_test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          contextRefs: [
            {
              refId: 'ref_inj_1',
              sourceConversationId: sourceSessionId,
              sourceProjectId: 'ws_test',
              titleAtAttach: 'Source Document Discussion',
              mode: 'snapshot' as const,
              snapshotUpToMessageId: 'src_m1',
              snapshotAt: Date.now(),
              messageCount: 1,
            },
          ],
        },
        {
          id: sourceSessionId,
          title: 'Source Document Discussion',
          workspaceId: 'ws_test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }
    writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

    const sourceMessagesPath = getAgentSessionMessagesPath(sourceSessionId)
    const sourceMessages: SDKMessage[] = [
      {
        id: 'src_m1',
        type: 'user',
        message: {
          role: 'user',
          content: 'Here is the key architectural decision: We use zero-copy IPC buffers.',
        },
      } as SDKMessage,
    ]
    writeFileSync(sourceMessagesPath, sourceMessages.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf-8')
    const messages = sourceMessages.map(normalizeSDKMessage).filter((m): m is NonNullable<typeof m> => m !== null)
    saveSnapshotToCache({ refId: 'ref_inj_1', sourceConversationId: sourceSessionId, sourceProjectId: 'ws_test', title: 'Source Document Discussion', snapshotUpToMessageId: 'src_m1', snapshotAt: Date.now(), messageCount: 1, estTokens: 100, contentHash: computeSnapshotHash(messages), messages })
  })

  afterAll(() => {
    setConfigHomeForTest(prevHome)
    try {
      rmSync(tempHome, { recursive: true, force: true })
    } catch {
      // cleanup ignored
    }
  })

  describe('injectReferencedConversationsIntoMessages', () => {
    it('prepends prompt to last user message without altering message roles', () => {
      const messages = [
        { role: 'system', content: 'You are an agent.' },
        { role: 'user', content: 'First user prompt' },
        { role: 'assistant', content: 'First assistant reply' },
        { role: 'user', content: 'Second user prompt' },
      ]

      const prompt = '<referenced_conversations>test background</referenced_conversations>'
      const result = injectReferencedConversationsIntoMessages(messages, prompt)

      expect(result.length).toBe(4)
      expect(result[0]!.role).toBe('system')
      expect(result[1]!.content).toBe('First user prompt')
      expect(result[2]!.role).toBe('assistant')
      expect(result[3]!.role).toBe('user')
      expect(result[3]!.content).toContain(prompt)
      expect(result[3]!.content).toContain('Second user prompt')

      // Input array was not mutated in place
      expect(messages[3]!.content).toBe('Second user prompt')
    })

    it('handles content blocks array correctly by updating text block', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this file' },
            { type: 'image', data: 'placeholder' },
          ],
        },
      ]

      const prompt = '<referenced_conversations>background info</referenced_conversations>'
      const result = injectReferencedConversationsIntoMessages(messages, prompt)

      const textBlock = (result[0]!.content as Array<{ type: string; text?: string }>).find((b) => b.type === 'text')
      expect(textBlock?.text).toContain(prompt)
      expect(textBlock?.text).toContain('Analyze this file')
    })
  })

  describe('Compaction Resilience & Turn-by-Turn Dynamic Re-injection', () => {
    it('re-injects reference after session compaction wipes historical turns', async () => {
      // 模拟压缩后的消息列表（仅剩一条压缩摘要与当前用户问题）
      const compactedMessages = [
        { role: 'assistant', content: 'Compacted summary of previous conversation turns.' },
        { role: 'user', content: 'Based on our previous discussion, what did we decide about IPC buffers?' },
      ]

      const transformed = await injectConversationReferencesContext({
        sessionId: testSessionId,
        messages: compactedMessages,
      })

      expect(transformed.length).toBe(2)
      const userContent = String(transformed[1]!.content)
      expect(userContent).toContain('<referenced_conversations>')
      expect(userContent).toContain('zero-copy IPC buffers')
      expect(userContent).toContain('Based on our previous discussion')
    })

    it('immediately revokes injection on the next turn when user removes the reference', async () => {
      // 用户从会话移除引用
      updateAgentContextRefs(testSessionId, [])

      const liveMessages = [
        { role: 'user', content: 'What about IPC buffers now?' },
      ]

      const transformed = await injectConversationReferencesContext({
        sessionId: testSessionId,
        messages: liveMessages,
      })

      const userContent = String(transformed[0]!.content)
      expect(userContent).not.toContain('<referenced_conversations>')
      expect(userContent).not.toContain('zero-copy IPC buffers')
      expect(userContent).toBe('What about IPC buffers now?')
    })

    it('When B摘要仍未响应 Then发送立即使用受预算摘录而不等待后台模型', async () => {
      writeFileSync(getAgentSessionMessagesPath(sourceSessionId), JSON.stringify({ uuid: 'huge-message', type: 'user', message: { role: 'user', content: '中'.repeat(20_000) } }) + '\n')
      const refs = updateAgentContextRefs(testSessionId, [{ refId: 'ignored', sourceConversationId: sourceSessionId, sourceProjectId: 'ws_test', titleAtAttach: 'fixture', mode: 'snapshot' }])
      let finish: (value: string | null) => void = () => {}
      const deps = { namespace: tempHome, generate: () => new Promise<string | null>((resolve) => { finish = resolve }) }
      expect(reconcileReferenceSummaries(testSessionId, refs, 'fixture-channel', 'fixture-model', deps)[refs[0]!.refId]).toBe('running')
      await Promise.resolve()
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        injectConversationReferencesContext({ sessionId: testSessionId, contextWindow: 20_000, messages: [{ role: 'user', content: 'current question' }] }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('发送错误地等待后台摘要')), 100) }),
      ]).finally(() => { clearTimeout(timer); finish(null) })
      expect(String(result[0]!.content)).toContain('current question')
      expect(String(result[0]!.content)).toContain('已自动降级')
      reconcileReferenceSummaries(testSessionId, [], undefined, undefined, deps)
    })
  })

  describe('Unavailable Reference Injections (Item 5)', () => {
    it('When 源对话已删除 Then 不静默跳过且注入不可用原因', async () => {
      const deletedRef = {
        refId: 'ref_del_1',
        sourceConversationId: 'non_existent_deleted_session',
        sourceProjectId: 'ws_test',
        titleAtAttach: '已删除的架构讨论',
        mode: 'snapshot' as const,
      }
      const messages = [{ role: 'user', content: '请总结' }]
      const result = await injectConversationReferencesContext({
        sessionId: testSessionId,
        contextRefs: [deletedRef],
        messages,
      })
      const text = String(result[0]!.content)
      expect(text).toContain('引用「已删除的架构讨论」当前不可用：源对话已删除')
      expect(text).toContain('<referenced_conversations>')
    })

    it('When 归属项目不符 Then 不静默跳过且注入归属异常提示', async () => {
      const mismatchedRef = {
        refId: 'ref_mismatch_1',
        sourceConversationId: sourceSessionId, // 真实 workspaceId 是 'ws_test'
        sourceProjectId: 'ws_attacker_project',
        titleAtAttach: '跨工作区伪造对话',
        mode: 'snapshot' as const,
      }
      const messages = [{ role: 'user', content: '请总结' }]
      const result = await injectConversationReferencesContext({
        sessionId: testSessionId,
        contextRefs: [mismatchedRef],
        messages,
      })
      const text = String(result[0]!.content)
      expect(text).toContain('当前不可用：对话归属项目不符')
    })

    it('When 快照缓存文件缺失 Then 不静默跳过且注入缓存缺失提示，绝不回源重建', async () => {
      const missingCacheRef = {
        refId: 'ref_snap_missing_file',
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_test',
        titleAtAttach: '缓存缺失对话',
        mode: 'snapshot' as const,
      }
      const messages = [{ role: 'user', content: '请总结' }]
      const result = await injectConversationReferencesContext({
        sessionId: testSessionId,
        contextRefs: [missingCacheRef],
        messages,
      })
      const text = String(result[0]!.content)
      expect(text).toContain('引用「缓存缺失对话」当前不可用：快照缓存缺失')
    })

    it('When 快照缓存损坏/哈希篡改 Then 不静默跳过且注入缓存损坏提示', async () => {
      const corruptRefId = 'ref_snap_corrupt_file'
      const corruptRef = {
        refId: corruptRefId,
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_test',
        titleAtAttach: '损坏快照对话',
        mode: 'snapshot' as const,
      }
      // 写入损坏的 json 文件
      const cachePath = getSnapshotCacheFilePathByRefId(corruptRefId)
      writeFileSync(cachePath, '{"broken_json": true, incomplete', 'utf-8')

      const messages = [{ role: 'user', content: '请总结' }]
      const result = await injectConversationReferencesContext({
        sessionId: testSessionId,
        contextRefs: [corruptRef],
        messages,
      })
      const text = String(result[0]!.content)
      expect(text).toContain('引用「损坏快照对话」当前不可用：快照缓存损坏')
    })

    it('When 正常空会话（0条消息）Then 绝不误判为缓存缺失或损坏', async () => {
      const emptyRefId = 'ref_snap_empty_valid'
      const emptyRef = {
        refId: emptyRefId,
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_test',
        titleAtAttach: '合法空会话',
        mode: 'snapshot' as const,
      }
      // 保存包含 0 条消息的合法快照
      saveSnapshotToCache({
        refId: emptyRefId,
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_test',
        title: '合法空会话',
        snapshotUpToMessageId: '',
        snapshotAt: Date.now(),
        messageCount: 0,
        estTokens: 0,
        contentHash: computeSnapshotHash([]),
        messages: [],
      })

      const messages = [{ role: 'user', content: '请总结' }]
      const result = await injectConversationReferencesContext({
        sessionId: testSessionId,
        contextRefs: [emptyRef],
        messages,
      })
      const text = String(result[0]!.content)
      expect(text).not.toContain('当前不可用')
    })
  })

  describe('Security & Lifecycle Regressions (Item 7)', () => {
    it('When 被引会话包含嵌套引用 Then 仅在正文注明标题而不递归展开嵌套消息', async () => {
      // 在 sourceMeta 中添加嵌套引用
      const indexPath = getAgentSessionsIndexPath()
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
      const source = index.sessions.find((s: { id: string }) => s.id === sourceSessionId)
      source.contextRefs = [
        {
          refId: 'nested_sub_ref_1',
          sourceConversationId: 'deep_nested_session',
          sourceProjectId: 'ws_test',
          titleAtAttach: '底层架构选型讨论',
          mode: 'snapshot',
        },
      ]
      writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')

      const ref = {
        refId: 'ref_top_1',
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_test',
        titleAtAttach: '上层需求讨论',
        mode: 'live' as const,
      }

      const result = await injectConversationReferencesContext({
        sessionId: testSessionId,
        contextRefs: [ref],
        messages: [{ role: 'user', content: '测试问题' }],
      })

      const injectedText = String(result[0]!.content)
      expect(injectedText).toContain('此对话曾引用过：底层架构选型讨论')
      // 绝不递归展开底层会话标签
      expect(injectedText).not.toContain('<conversation id="nested_sub_ref_1"')
      expect(injectedText).not.toContain('deep_nested_session')
    })

    it('When 用户尝试添加自身会话或重复会话引用 Then updateAgentContextRefs 严格去重并拒绝自引', () => {
      // 传入 3 项：一项自引(testSessionId)，两项重复(sourceSessionId)
      const inputRefs = [
        { sourceConversationId: testSessionId, mode: 'snapshot' as const },
        { sourceConversationId: sourceSessionId, mode: 'snapshot' as const },
        { sourceConversationId: sourceSessionId, mode: 'snapshot' as const },
      ]

      const updated = updateAgentContextRefs(testSessionId, inputRefs)
      // 自引被自动丢弃，重复项被去重，仅剩 1 项
      expect(updated.length).toBe(1)
      expect(updated[0]!.sourceConversationId).toBe(sourceSessionId)
      expect(updated.some((r) => r.sourceConversationId === testSessionId)).toBe(false)
    })

    it('When 处理带 Canary 标记的引用全文与摘要 When 经过完整注入与控制台输出 Then 严禁在 console / logger 中泄露 Canary 全文', async () => {
      const canaryBody = 'CANARY_CONFIDENTIAL_CORPUS_987654_DO_NOT_LOG'
      const canarySummary = 'CANARY_CONFIDENTIAL_SUMMARY_876543_DO_NOT_LOG'

      const logs: string[] = []
      const origLog = console.log
      const origWarn = console.warn
      const origError = console.error

      console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))
      console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '))
      console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '))

      try {
        const canaryRefId = 'ref_canary_log_test'
        const canaryMessages: NormalizedReferencedMessage[] = [
          { id: 'c1', role: 'user', content: `秘密报告: ${canaryBody}` },
        ]

        saveSnapshotToCache({
          refId: canaryRefId,
          sourceConversationId: sourceSessionId,
          sourceProjectId: 'ws_test',
          title: 'Canary Session',
          snapshotUpToMessageId: 'c1',
          snapshotAt: Date.now(),
          messageCount: 1,
          estTokens: 100,
          contentHash: computeSnapshotHash(canaryMessages),
          messages: canaryMessages,
        })

        const ref = {
          refId: canaryRefId,
          sourceConversationId: sourceSessionId,
          sourceProjectId: 'ws_test',
          titleAtAttach: 'Canary Session',
          mode: 'snapshot' as const,
          snapshotUpToMessageId: 'c1',
        }

        await injectConversationReferencesContext({
          sessionId: testSessionId,
          contextRefs: [ref],
          messages: [{ role: 'user', content: 'Canary 提问' }],
        })

        // 检验所有 console.log / warn / error 输出
        const allLogged = logs.join('\n')
        expect(allLogged).not.toContain(canaryBody)
        expect(allLogged).not.toContain(canarySummary)
      } finally {
        console.log = origLog
        console.warn = origWarn
        console.error = origError
      }
    })
  })
})
