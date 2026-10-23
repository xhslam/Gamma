import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  formatNormalizedMessage,
  formatToolCallSummary,
  normalizeSDKMessage,
  normalizeCompleteSDKMessages,
  redactCredentials,
  buildReferencedContext,
  type NormalizedReferencedMessage,
} from './context-builder'
import {
  createConversationReferenceExtension,
  getReferencedMessagesForRef,
} from './pi-tools'
import { saveSnapshotToCache, computeSnapshotHash } from './ref-cache'
import { setConfigHomeForTest, getAgentSessionsIndexPath, getAgentSessionMessagesPath } from '../config-paths'
import type { AgentContextRef, SDKMessage } from '@gamma/shared'

describe('Credential Redaction & Field Coverage (Item 8)', () => {
  const CANARY_SK = 'sk-proj-CANARY98765432109876543210abcdef'
  const CANARY_AKIA = 'AKIAIOSFODNN7EXAMPLE'
  const CANARY_GHP = 'ghp_CANARY9876543210abcdefghijklmnopqrstuv'
  const CANARY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+CANARY_PRIVATE_KEY_BYTES_LINE1
CANARY_PRIVATE_KEY_BYTES_LINE2==
-----END RSA PRIVATE KEY-----`

  describe('Pure redactCredentials', () => {
    it('When 包含常见凭据 When 脱敏 Then 替换为对应脱敏占位符', () => {
      expect(redactCredentials(`API Key is ${CANARY_SK}`)).toBe('API Key is [REDACTED_API_KEY]')
      expect(redactCredentials(`AWS Key is ${CANARY_AKIA}`)).toBe('AWS Key is [REDACTED_AWS_KEY]')
      expect(redactCredentials(`GitHub Token is ${CANARY_GHP}`)).toBe('GitHub Token is [REDACTED_GITHUB_TOKEN]')
      expect(redactCredentials(`Private Key:\n${CANARY_PEM}`)).toBe('Private Key:\n[REDACTED_PRIVATE_KEY]')
    })

    it('When 多行 Private Key 跨越多行且可能缺少破折号 Then 依然正确匹配脱敏，绝不因单行正则遗漏', () => {
      const multilineNoDashes = `BEGIN OPENSSH PRIVATE KEY
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn
NhAAAAAwEAAQAAAYEA0b+canary
END OPENSSH PRIVATE KEY`
      const redacted = redactCredentials(multilineNoDashes)
      expect(redacted).toBe('[REDACTED_PRIVATE_KEY]')
      expect(redacted).not.toContain('b3BlbnNza')
    })

    it('When 普通代码或文本包含形似词汇（非凭据）Then 保持原样不误伤', () => {
      const normalText = 'We generated a private key on server. Short token sk-123 is test. Service AKIAMODEL. Token ghp_test.'
      expect(redactCredentials(normalText)).toBe(normalText)
    })
  })

  describe('All 7 Fields Output Coverage (正文、工具名、关键参数、结果摘要、附件名、标题、summary)', () => {
    let tempHome: string
    let prevHome: string | undefined

    const currentSessionId = 'cur_session_redact'
    const sourceSessionId = 'src_session_redact'
    const refId = 'ref_redact_test'

    beforeAll(() => {
      tempHome = mkdtempSync(join(tmpdir(), 'gamma-redact-test-'))
      prevHome = setConfigHomeForTest(tempHome)

      const indexPath = getAgentSessionsIndexPath()
      const indexData = {
        version: 1,
        sessions: [
          {
            id: currentSessionId,
            title: 'Current Work',
            workspaceId: 'ws_a',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            contextRefs: [
              {
                refId,
                sourceConversationId: sourceSessionId,
                sourceProjectId: 'ws_a',
                titleAtAttach: `Source with ${CANARY_AKIA} in Title`,
                mode: 'snapshot' as const,
                snapshotUpToMessageId: 'm1',
                snapshotAt: Date.now(),
                messageCount: 1,
              },
            ],
          },
          {
            id: sourceSessionId,
            title: `Source with ${CANARY_AKIA} in Title`,
            workspaceId: 'ws_a',
            channelId: 'chan-src',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }
      writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')
    })

    afterAll(() => {
      if (prevHome) setConfigHomeForTest(prevHome)
      rmSync(tempHome, { recursive: true, force: true })
    })

    it('Given 7 类字段均包含不同凭据 When 经过 normalizeSDKMessage / formatNormalizedMessage Then 全部字段脱敏', () => {
      // 字段 1: 正文 (content)
      // 字段 2: 工具名 (tool name)
      // 字段 3: 关键参数 (keyParam)
      // 字段 4: 结果摘要 (resultSummary)
      // 字段 5: 附件名 (attachment name)
      const rawUserMsg: SDKMessage = {
        id: 'm1',
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: `用户在正文中贴了凭证: ${CANARY_SK}` },
            {
              type: 'tool_result',
              tool_use_id: `tool_${CANARY_AKIA}`,
              content: `工具输出结果摘要中包含密钥:\n${CANARY_PEM}`,
            },
          ],
        },
        attachments: [
          { name: `secret-file-${CANARY_GHP}.pem`, type: 'text/plain' },
        ],
      } as unknown as SDKMessage

      const rawAssistantMsg: SDKMessage = {
        id: 'm2',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: `助手结论包含私钥:\n${CANARY_PEM}` },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: `execute_cmd_${CANARY_GHP}`,
              input: { path: `/certs/${CANARY_SK}/cert.key` },
            },
          ],
        },
      } as unknown as SDKMessage

      const normalized1 = normalizeSDKMessage(rawUserMsg)
      expect(normalized1).not.toBeNull()
      const formatted1 = formatNormalizedMessage(normalized1!)

      // 验证正文
      expect(formatted1).not.toContain(CANARY_SK)
      expect(formatted1).toContain('[REDACTED_API_KEY]')

      // 验证工具名与结果摘要
      expect(formatted1).not.toContain(CANARY_AKIA)
      expect(formatted1).not.toContain(CANARY_PEM)
      expect(formatted1).toContain('[REDACTED_AWS_KEY]')
      expect(formatted1).toContain('[REDACTED_PRIVATE_KEY]')

      // 验证附件名
      expect(formatted1).not.toContain(CANARY_GHP)
      expect(formatted1).toContain('[REDACTED_GITHUB_TOKEN]')

      const normalized2 = normalizeSDKMessage(rawAssistantMsg)
      expect(normalized2).not.toBeNull()
      const formatted2 = formatNormalizedMessage(normalized2!)

      // 验证助手正文、工具名及关键参数
      expect(formatted2).not.toContain(CANARY_PEM)
      expect(formatted2).not.toContain(CANARY_GHP)
      expect(formatted2).not.toContain(CANARY_SK)
      expect(formatted2).toContain('[REDACTED_PRIVATE_KEY]')
      expect(formatted2).toContain('[REDACTED_GITHUB_TOKEN]')
      expect(formatted2).toContain('[REDACTED_API_KEY]')
    })

    it('Given 标题(6)与摘要(7)包含凭据 When 构建上下文 (Tier A & Tier B) Then 严禁输出原始凭据', () => {
      const messages: NormalizedReferencedMessage[] = [
        { id: 'm1', role: 'user', content: '测试内容' },
      ]

      // 字段 6: 标题 (title)
      const refData = {
        refId: 'r1',
        sourceConversationId: 'src_1',
        sourceProjectId: 'ws_a',
        title: `报告标题包含 ${CANARY_AKIA}`,
        mode: 'snapshot' as const,
        messages,
      }

      // Tier A 构建
      const resultA = buildReferencedContext([refData], 10_000, { forceTier: 'A' })
      expect(resultA.injectedPrompt).not.toContain(CANARY_AKIA)
      expect(resultA.injectedPrompt).toContain('[REDACTED_AWS_KEY]')

      // 字段 7: summary
      const modelSummaries = new Map<string, string>()
      modelSummaries.set('r1', `结构化摘要包含私钥:\n${CANARY_PEM}\n以及 ${CANARY_SK}`)

      // Tier B 构建
      const resultB = buildReferencedContext([refData], 10_000, {
        forceTier: 'B',
        modelSummaries,
      })
      expect(resultB.injectedPrompt).not.toContain(CANARY_PEM)
      expect(resultB.injectedPrompt).not.toContain(CANARY_SK)
      expect(resultB.injectedPrompt).not.toContain(CANARY_AKIA)
      expect(resultB.injectedPrompt).toContain('[REDACTED_PRIVATE_KEY]')
      expect(resultB.injectedPrompt).toContain('[REDACTED_API_KEY]')
      expect(resultB.injectedPrompt).toContain('[REDACTED_AWS_KEY]')
    })

    it('Given 磁盘源会话文件包含凭据 When 执行工具与上下文规范化 Then 源文件保持只读，原字节绝不篡改', async () => {
      const sourceMessagesPath = getAgentSessionMessagesPath(sourceSessionId)
      const rawFileContent = JSON.stringify({
        id: 'm1',
        type: 'user',
        message: { role: 'user', content: `原始用户输入保存在磁盘: ${CANARY_SK}` },
      }) + '\n'
      writeFileSync(sourceMessagesPath, rawFileContent, 'utf-8')

      // 保存快照
      saveSnapshotToCache({
        refId,
        sourceConversationId: sourceSessionId,
        sourceProjectId: 'ws_a',
        title: `Source with ${CANARY_AKIA} in Title`,
        snapshotUpToMessageId: 'm1',
        snapshotAt: Date.now(),
        messageCount: 1,
        estTokens: 100,
        contentHash: computeSnapshotHash([
          { id: 'm1', role: 'user', content: `原始用户输入保存在磁盘: ${CANARY_SK}` },
        ]),
        messages: [
          { id: 'm1', role: 'user', content: `原始用户输入保存在磁盘: ${CANARY_SK}` },
        ],
      })

      // 注册并调用工具
      const registeredTools: Record<string, any> = {}
      const mockPi: any = {
        registerTool: (tool: any) => {
          registeredTools[tool.name] = tool
        },
      }
      createConversationReferenceExtension(currentSessionId)(mockPi)

      // 1. list_referenced_conversations (验证 title 脱敏)
      const listRes = await registeredTools.list_referenced_conversations.execute()
      const listText = listRes.content[0].text
      expect(listText).not.toContain(CANARY_AKIA)
      expect(listText).toContain('[REDACTED_AWS_KEY]')

      // 2. read_referenced_conversation (验证 content 脱敏)
      const readRes = await registeredTools.read_referenced_conversation.execute('call_1', { id: refId })
      const readText = readRes.content[0].text
      expect(readText).not.toContain(CANARY_SK)
      expect(readText).not.toContain(CANARY_AKIA)
      expect(readText).toContain('[REDACTED_API_KEY]')
      expect(readText).toContain('[REDACTED_AWS_KEY]')

      // 3. search_referenced_conversation (验证 search 脱敏)
      const searchRes = await registeredTools.search_referenced_conversation.execute('call_2', { id: refId, query: '磁盘' })
      const searchText = searchRes.content[0].text
      expect(searchText).not.toContain(CANARY_SK)
      expect(searchText).not.toContain(CANARY_AKIA)
      expect(searchText).toContain('[REDACTED_API_KEY]')
      expect(searchText).toContain('[REDACTED_AWS_KEY]')

      // 验证源文件保持完全一致，源只读
      const fileOnDisk = readFileSync(sourceMessagesPath, 'utf-8')
      expect(fileOnDisk).toBe(rawFileContent)
      expect(fileOnDisk).toContain(CANARY_SK)
    })
  })
})
