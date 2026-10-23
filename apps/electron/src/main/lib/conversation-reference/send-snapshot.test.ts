import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentContextRef, AgentSendOutboxEntry } from '@gamma/shared'
import { setConfigHomeForTest } from '../config-paths'
import { appendSDKMessages, createAgentSession, updateAgentContextRefs } from '../agent-session-manager'
import { AgentSendOutbox } from '../agent-send-outbox'
import { prepareOutboxRetryInput } from '../agent-send-outbox-retry-policy'
import { captureReferenceSnapshot, getRetryReferenceSnapshot, parseReferenceSnapshot, ReferenceTurnTracker } from './send-snapshot'
import { validateAndFindRef } from './pi-tools'
import { injectConversationReferencesContext } from './context-injector'

let root: string, previous: string | undefined, target: string, sourceA: string, sourceB: string
let a: AgentContextRef[], b: AgentContextRef[]
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gamma-reference-send-')); previous = setConfigHomeForTest(root)
  sourceA = (await createAgentSession('旧资料A')).id
  sourceB = (await createAgentSession('新资料B')).id
  target = (await createAgentSession('目标')).id
  for (const [id, text] of [[sourceA, 'frozen-A-canary'], [sourceB, 'composer-B-canary']] as const) appendSDKMessages(id, [{ type: 'user', uuid: `message-${id}`, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } }])
  a = updateAgentContextRefs(target, [{ refId: 'ignored-a', sourceConversationId: sourceA, sourceProjectId: '', titleAtAttach: '', mode: 'snapshot' }])
  a = captureReferenceSnapshot(target)
  b = updateAgentContextRefs(target, [{ refId: 'ignored-b', sourceConversationId: sourceB, sourceProjectId: '', titleAtAttach: '', mode: 'snapshot' }])
})
afterAll(() => { setConfigHomeForTest(previous); rmSync(root, { recursive: true, force: true }) })

describe('Given Main收到消息时冻结引用', () => {
  it('When未传或明确[] Then分别取当前白名单或不引用，非法/已移除ID拒绝', () => {
    expect(captureReferenceSnapshot(target)).toEqual(b)
    expect(captureReferenceSnapshot(target, [])).toEqual([])
    expect(() => captureReferenceSnapshot(target, [a[0]!.refId])).toThrow('未获授权')
    expect(() => captureReferenceSnapshot(target, ['../escape'])).toThrow()
    expect(() => captureReferenceSnapshot(target, [b[0]!.refId, b[0]!.refId])).toThrow()
  })
  it('Whencomposer已换B Then已收消息的注入和工具仅允许A，明确空引用不回读B', async () => {
    const messages = [{ role: 'user', content: '现在的问题' }]
    const transformed = await injectConversationReferencesContext({ sessionId: target, contextRefs: a, messages })
    expect(String(transformed[0]!.content)).toContain('frozen-A-canary')
    expect(String(transformed[0]!.content)).not.toContain('composer-B-canary')
    expect(validateAndFindRef(target, a[0]!.refId, a)).toHaveProperty('ref')
    expect(validateAndFindRef(target, b[0]!.refId, a)).toHaveProperty('error')
    expect(await injectConversationReferencesContext({ sessionId: target, contextRefs: [], messages })).toEqual(messages)
  })
  it('When重启恢复outbox再重试 Then保留A完整描述而不采用当前B', () => {
    const store = new AgentSendOutbox(() => join(root, 'test-outbox.json'))
    const entry: AgentSendOutboxEntry = { id: 'request1', sessionId: target, status: 'pending', createdAt: 1, draft: { text: 'question', html: '', attachments: [] }, input: { sessionId: target, queueMessageId: 'request1', userMessageUuid: 'request1', userMessage: 'question', channelId: 'fixture', dispatch: 'after_current', contextRefIds: a.map((ref) => ref.refId), contextRefs: a } }
    store.save(entry)
    const restored = new AgentSendOutbox(() => join(root, 'test-outbox.json')).list(target)[0]!
    expect(prepareOutboxRetryInput(restored, { workspaceId: 'ws', permissionMode: 'bypassPermissions', directories: [], files: [] }).contextRefs).toEqual(a)
    expect(restored.input.contextRefIds).toEqual(a.map((ref) => ref.refId))
    expect(() => parseReferenceSnapshot([{ ...a[0], mode: 'invalid' }])).toThrow()
    expect(() => parseReferenceSnapshot([a[0], a[0]])).toThrow()
  })
  it('When重试已落盘错误 Then采用原用户快照，旧历史缺字段明确为[]', () => {
    appendSDKMessages(target, [{ type: 'user', uuid: 'retry-user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'fixture' }] }, contextRefs: a }, { type: 'assistant', uuid: 'retry-error', error: 'fixture', parent_tool_use_id: null, message: { role: 'assistant', content: [] } }])
    expect(getRetryReferenceSnapshot(target, 'retry-user')).toEqual(a)
    expect(getRetryReferenceSnapshot(target, undefined, 'retry-error')).toEqual(a)
    expect(() => getRetryReferenceSnapshot(target, 'unknown')).toThrow()
    appendSDKMessages(target, [{ type: 'user', uuid: 'legacy-user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'legacy' }] } }])
    expect(getRetryReferenceSnapshot(target, 'legacy-user')).toEqual([])
  })
  it('When排队B尚未消费 ThenA工具白名单不变；消费后才切换，取消不重放旧权限', () => {
    const tracker = new ReferenceTurnTracker(a)
    tracker.register('queued-b', 'same prompt', b)
    expect(tracker.get()).toEqual(a)
    tracker.consume('unrelated system prompt')
    expect(tracker.get()).toEqual(a)
    tracker.consume('same prompt')
    expect(tracker.get()).toEqual(b)
    tracker.register('cancelled', 'same prompt', a)
    tracker.discard('cancelled')
    tracker.register('empty', 'same prompt', [])
    tracker.consume('same prompt')
    expect(tracker.get()).toEqual([])
  })
})
