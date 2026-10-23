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

    describe('Item 6 集中脱敏追加与反例防御规则', () => {
      it('1. AIza 后 35 字符 [0-9A-Za-z_-] 正例与反例', () => {
        const validAIza = 'AIzaSyD-1234567890abcdefghijklmnopqrstu' // 4 + 35 = 39 字符
        expect(redactCredentials(`Google API Key: ${validAIza}`)).toBe('Google API Key: [REDACTED_API_KEY]')
        expect(redactCredentials(`{"apiKey": "${validAIza}"}`)).toBe('{"apiKey": "[REDACTED_API_KEY]"}')

        // 反例：过短、无 AIza 前缀、普通词汇
        expect(redactCredentials('AIzaShort')).toBe('AIzaShort')
        expect(redactCredentials('AIza12345')).toBe('AIza12345')
        expect(redactCredentials('function handleAIzaCall() {}')).toBe('function handleAIzaCall() {}')
      })

      it('2. Slack Token xox[baprs]- 正例与反例', () => {
        expect(redactCredentials('Token: xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx')).toBe('Token: [REDACTED_SLACK_TOKEN]')
        expect(redactCredentials('Token: xoxa-1234567890-abcdefghij')).toBe('Token: [REDACTED_SLACK_TOKEN]')
        expect(redactCredentials('Token: xoxp-1234567890-abcdefghij')).toBe('Token: [REDACTED_SLACK_TOKEN]')
        expect(redactCredentials('Token: xoxr-1234567890-abcdefghij')).toBe('Token: [REDACTED_SLACK_TOKEN]')
        expect(redactCredentials('Token: xoxs-1234567890-abcdefghij')).toBe('Token: [REDACTED_SLACK_TOKEN]')

        // 反例：非 baprs、过短
        expect(redactCredentials('xox-unknown-token')).toBe('xox-unknown-token')
        expect(redactCredentials('xoxb-short')).toBe('xoxb-short')
        expect(redactCredentials('xoxc-1234567890123456')).toBe('xoxc-1234567890123456')
      })

      it('3. github_pat_ 细粒度个人令牌正例与反例', () => {
        const pat = 'github_pat_11ABCD0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
        expect(redactCredentials(`GitHub Pat: ${pat}`)).toBe('GitHub Pat: [REDACTED_GITHUB_TOKEN]')

        // 反例：过短
        expect(redactCredentials('github_pat_short')).toBe('github_pat_short')
        expect(redactCredentials('github_pat_')).toBe('github_pat_')
      })

      it('4. gh[opusr]_ 经典 GitHub 令牌正例与反例', () => {
        expect(redactCredentials('ghp_1234567890abcdefghijklmnopqrstuvwxyzAB')).toBe('[REDACTED_GITHUB_TOKEN]')
        expect(redactCredentials('gho_1234567890abcdefghijklmnopqrstuvwxyzAB')).toBe('[REDACTED_GITHUB_TOKEN]')
        expect(redactCredentials('ghu_1234567890abcdefghijklmnopqrstuvwxyzAB')).toBe('[REDACTED_GITHUB_TOKEN]')
        expect(redactCredentials('ghs_1234567890abcdefghijklmnopqrstuvwxyzAB')).toBe('[REDACTED_GITHUB_TOKEN]')
        expect(redactCredentials('ghr_1234567890abcdefghijklmnopqrstuvwxyzAB')).toBe('[REDACTED_GITHUB_TOKEN]')

        // 反例：过短或非 opusr 前缀或普通单词
        expect(redactCredentials('ghp_test')).toBe('ghp_test')
        expect(redactCredentials('ghx_1234567890abcdefghijklmnopqrstuvwxyzAB')).toBe('ghx_1234567890abcdefghijklmnopqrstuvwxyzAB')
        expect(redactCredentials('ghost_protocol')).toBe('ghost_protocol')
      })

      it('5. JWT eyJ... 正例与反例', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
        expect(redactCredentials(`Token: ${jwt}`)).toBe('Token: [REDACTED_JWT_TOKEN]')

        // 反例：非三段式、段落过短
        expect(redactCredentials('eyJnotajwt')).toBe('eyJnotajwt')
        expect(redactCredentials('eyJabc.short.jwt')).toBe('eyJabc.short.jwt')
        expect(redactCredentials('eyJhbGciOiJIUzI1NiJ9')).toBe('eyJhbGciOiJIUzI1NiJ9')
      })

      it('6. Bearer token 正例与反例', () => {
        expect(redactCredentials('Authorization: Bearer ya29.a0AfH6SMB_secret_access_token_12345')).toBe('Authorization: Bearer [REDACTED_TOKEN]')
        expect(redactCredentials('Bearer secret_token_value_9876543210')).toBe('Bearer [REDACTED_TOKEN]')

        // 反例：普通语句或非凭证文本
        expect(redactCredentials('Bearer of good news')).toBe('Bearer of good news')
        expect(redactCredentials('The Bearer token pattern')).toBe('The Bearer token pattern')
        expect(redactCredentials('Bearer abc')).toBe('Bearer abc')
      })

      it('7. URL 内嵌凭据正例与反例', () => {
        expect(redactCredentials('https://admin:password123@api.example.com/v1/query')).toBe('https://[REDACTED_CREDENTIALS]@api.example.com/v1/query')
        expect(redactCredentials('http://alice:secret_pass@127.0.0.1:7890')).toBe('http://[REDACTED_CREDENTIALS]@127.0.0.1:7890')
        expect(redactCredentials('postgresql://postgres:p%40ssword!@localhost:5432/mydb')).toBe('postgresql://[REDACTED_CREDENTIALS]@localhost:5432/mydb')

        // 反例：普通 URL、Query 参数中带 email、普通邮箱等
        expect(redactCredentials('https://api.example.com/v1/query?email=alice@example.com')).toBe('https://api.example.com/v1/query?email=alice@example.com')
        expect(redactCredentials('http://example.com/users/bob@work.com')).toBe('http://example.com/users/bob@work.com')
        expect(redactCredentials('https://example.com/path/to/resource')).toBe('https://example.com/path/to/resource')
        expect(redactCredentials('contact support@example.com for help')).toBe('contact support@example.com for help')
      })

      it('8. 变量名含 KEY/SECRET/TOKEN/PASSWORD 的 KEY=VALUE 正例与反例', () => {
        expect(redactCredentials('API_KEY="custom-super-secret-key"')).toBe('API_KEY="[REDACTED]"')
        expect(redactCredentials("MY_SECRET='super-secret-vault-password'")).toBe("MY_SECRET='[REDACTED]'")
        expect(redactCredentials('export CLIENT_SECRET="xyz-987"')).toBe('export CLIENT_SECRET="[REDACTED]"')
        expect(redactCredentials('USER_PASSWORD=VerySecretPassword123!')).toBe('USER_PASSWORD=[REDACTED]')
        expect(redactCredentials('ACCESS_TOKEN=my_custom_secret_token_12345')).toBe('ACCESS_TOKEN=[REDACTED]')

        // 反例：比较表达式、布尔值、数字按键与计数常量、函数调用
        expect(redactCredentials('if (token === currentToken)')).toBe('if (token === currentToken)')
        expect(redactCredentials('if (key != null)')).toBe('if (key != null)')
        expect(redactCredentials('let hasKey = true')).toBe('let hasKey = true')
        expect(redactCredentials('const isTokenValid = false')).toBe('const isTokenValid = false')
        expect(redactCredentials('const tokenCount = 10')).toBe('const tokenCount = 10')
        expect(redactCredentials('const maxTokens = 4096')).toBe('const maxTokens = 4096')
        expect(redactCredentials('KEY_ENTER = 13')).toBe('KEY_ENTER = 13')
        expect(redactCredentials('const key = getKey()')).toBe('const key = getKey()')
      })

      it('9. 先脱敏后截断：超长凭据在截断前已被安全遮蔽，绝不泄漏前缀残余', () => {
        const longSecret = 'API_KEY="sk-proj-12345678901234567890123456789012345678901234567890"'
        // 若先截断前 15 字符，会变成 API_KEY="sk-pro ，导致泄漏 sk-pro
        // 先脱敏后截断，脱敏后为 API_KEY="[REDACTED_API_KEY]"
        const redacted = redactCredentials(longSecret)
        expect(redacted).not.toContain('1234567890')
        expect(redacted).toContain('[REDACTED_API_KEY]')
        const truncated = redacted.slice(0, 20)
        expect(truncated).not.toContain('1234567890')
      })
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
