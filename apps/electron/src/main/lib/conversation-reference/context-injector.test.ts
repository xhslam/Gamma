import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setConfigHomeForTest, getAgentSessionsIndexPath, getAgentSessionMessagesPath } from '../config-paths'
import {
  injectConversationReferencesContext,
  injectReferencedConversationsIntoMessages,
} from './context-injector'
import { updateAgentSessionMeta } from '../agent-session-manager'
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
      updateAgentSessionMeta(testSessionId, { contextRefs: [] })

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
  })
})
