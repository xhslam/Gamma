import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentContextRef, AgentSendInput } from '@gamma/shared'
import { setConfigHomeForTest } from '../config-paths'
import { appendSDKMessages, createAgentSession, updateAgentContextRefs } from '../agent-session-manager'
import {
  captureReferenceSnapshot,
  prepareAgentReferenceInput,
  registerReferenceWarningListener,
  isReferencePreparationError,
} from './send-snapshot'
import { injectConversationReferencesContext } from './context-injector'

let root: string
let previous: string | undefined
let targetSessionId: string
let sourceSessionId: string
let authorizedRef: AgentContextRef

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gamma-ref-zero-impact-'))
  previous = setConfigHomeForTest(root)
  sourceSessionId = (await createAgentSession('源会话')).id
  targetSessionId = (await createAgentSession('目标会话')).id
  appendSDKMessages(sourceSessionId, [
    {
      type: 'user',
      uuid: 'msg-source',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'source-content-canary' }] },
    },
  ])
  const updated = updateAgentContextRefs(targetSessionId, [
    {
      refId: 'valid-ref-1',
      sourceConversationId: sourceSessionId,
      sourceProjectId: '',
      titleAtAttach: '源标题',
      mode: 'snapshot',
    },
  ])
  authorizedRef = updated[0]!
})

afterAll(() => {
  setConfigHomeForTest(previous)
  rmSync(root, { recursive: true, force: true })
})

describe('Feature: 无引用零影响与异常降级保证消息不丢失', () => {
  describe('Rule 1: 显式 [] 短路与无引用零影响', () => {
    it('When 显式传空数组 [] Then 不读取任何引用缓存、不修改业务 payload', async () => {
      // 1. captureReferenceSnapshot 针对 [] 短路
      const captured = captureReferenceSnapshot(targetSessionId, [])
      expect(captured).toEqual([])

      // 2. prepareAgentReferenceInput 针对 [] 短路
      const rawInput: AgentSendInput = {
        sessionId: targetSessionId,
        userMessage: '用户原始提问-canary',
        rawUserMessage: '原始显示输入',
        additionalDirectories: ['/path/to/demo'],
        contextRefIds: [],
        channelId: 'channel-test',
        modelId: 'model-test',
      }
      const prepared = prepareAgentReferenceInput(rawInput)

      // 验证业务 payload 严格未变
      expect(prepared.userMessage).toBe('用户原始提问-canary')
      expect(prepared.rawUserMessage).toBe('原始显示输入')
      expect(prepared.additionalDirectories).toEqual(['/path/to/demo'])
      expect(prepared.channelId).toBe('channel-test')
      expect(prepared.modelId).toBe('model-test')
      expect(prepared.contextRefIds).toEqual([])
      expect(prepared.contextRefs).toEqual([])

      // 3. 上下文注入在无引用时原样返回，不调模型、不读缓存
      const messages = [{ role: 'user', content: '用户原始提问-canary' }]
      const injected = await injectConversationReferencesContext({
        sessionId: targetSessionId,
        contextRefs: prepared.contextRefs,
        messages,
      })
      expect(injected).toEqual(messages)
    })
  })

  describe('Rule 2: undefined 旧客户端兼容', () => {
    it('When contextRefIds 为 undefined Then 兼容读取当前授权的引用快照', () => {
      const captured = captureReferenceSnapshot(targetSessionId, undefined)
      expect(captured.length).toBe(1)
      expect(captured[0]!.refId).toBe(authorizedRef.refId)

      const rawInput: AgentSendInput = {
        sessionId: targetSessionId,
        userMessage: '旧客户端发送',
        channelId: 'channel-test',
        contextRefIds: undefined,
      }
      const prepared = prepareAgentReferenceInput(rawInput)
      expect(prepared.contextRefs?.length).toBe(1)
      expect(prepared.contextRefs?.[0]?.refId).toBe(authorizedRef.refId)
      expect(prepared.contextRefIds).toEqual([authorizedRef.refId])
    })
  })

  describe('Rule 3: 异常不丢消息 — 捕获引用准备/快照错误，降级无引用并通知用户', () => {
    it('When 携带伪造未授权引用 ID 时 Then 降级为无引用发送、保留正文附件、绝不能被当做有效授权，且通知用户', () => {
      const warnings: Array<{ sessionId: string; warning: string }> = []
      const unregister = registerReferenceWarningListener((notice) => {
        warnings.push(notice)
      })

      try {
        const rawInput: AgentSendInput = {
          sessionId: targetSessionId,
          userMessage: '重要正文不能丢',
          channelId: 'channel-test',
          additionalDirectories: ['/path/to/extra'],
          contextRefIds: ['forged-unauthorized-ref-id'],
        }

        const prepared = prepareAgentReferenceInput(rawInput)

        // 核心断言：正文与附件/附加目录完好保留
        expect(prepared.userMessage).toBe('重要正文不能丢')
        expect(prepared.additionalDirectories).toEqual(['/path/to/extra'])

        // 核心断言：引用被安全剥离，绝不把伪造引用当有效授权
        expect(prepared.contextRefIds).toEqual([])
        expect(prepared.contextRefs).toEqual([])

        // 下游 capture 检查：由于 contextRefs 是 []，下游 ?? 绝不回读 composer 的有效引用
        const downstreamSnapshot = prepared.contextRefs ?? captureReferenceSnapshot(targetSessionId, prepared.contextRefIds)
        expect(downstreamSnapshot).toEqual([])

        // 核心断言：用户可见告警路径被实际触发
        expect(warnings.length).toBeGreaterThan(0)
        expect(warnings[0]!.sessionId).toBe(targetSessionId)
        expect(warnings[0]!.warning).toBe('引用准备失败，已转为无引用继续发送')
      } finally {
        unregister()
      }
    })

    it('When 重试引用的原用户消息不存在时 Then 降级为无引用发送而不抛出中断', () => {
      const warnings: Array<{ sessionId: string; warning: string }> = []
      const unregister = registerReferenceWarningListener((notice) => warnings.push(notice))

      try {
        const rawInput: AgentSendInput = {
          sessionId: targetSessionId,
          userMessage: '重试消息',
          channelId: 'channel-test',
          retryOfUserMessageUuid: 'non-existent-user-message-uuid',
        }
        const prepared = prepareAgentReferenceInput(rawInput)
        expect(prepared.userMessage).toBe('重试消息')
        expect(prepared.contextRefs).toEqual([])
        expect(warnings.length).toBe(1)
        expect(warnings[0]!.warning).toBe('引用准备失败，已转为无引用继续发送')
      } finally {
        unregister()
      }
    })
  })

  describe('Rule 4: 不能吞非引用异常', () => {
    it('When 抛出非引用相关错误时 Then 绝不吞掉，继续向外冒泡', () => {
      expect(isReferencePreparationError(new Error('未获授权'))).toBe(true)
      expect(isReferencePreparationError(new Error('发送引用 ID 无效'))).toBe(true)
      expect(isReferencePreparationError(new Error('消息引用快照无效'))).toBe(true)
      expect(isReferencePreparationError(new Error('重试的原用户消息不存在'))).toBe(true)

      // 非引用异常判定
      const genericError = new TypeError('Cannot read properties of null (reading foo)')
      expect(isReferencePreparationError(genericError)).toBe(false)

      const dbCrashError = new Error('Database disk image is malformed')
      expect(isReferencePreparationError(dbCrashError)).toBe(false)
    })
  })
})


test('Given 同一消息已冻结A When 当前composer明确清空 Then 仍保留Main已保存的A而非覆盖', () => {
  const input = { sessionId: targetSessionId, userMessage: 'keep', contextRefIds: [] as string[] }
  const prepared = prepareAgentReferenceInput(input, { savedRefs: [authorizedRef] })
  expect(prepared.contextRefIds).toEqual([authorizedRef.refId])
})
