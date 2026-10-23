import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { GammaPermissionMode, SDKMessage, SDKUserMessageInput } from '@gamma/shared'
import { isStaleActiveQueueError } from './agent-queue-routing'

interface QueueSubject {
  activeSessions: Map<string, number>
  activeSessionStartedAt: Map<string, number>
  sessionPermissionModes: Map<string, GammaPermissionMode>
  queuedMessageUuids: Map<string, Set<string>>
  adapter: { sendQueuedMessage: (sessionId: string, message: SDKUserMessageInput) => Promise<void> }
  flushPendingUserSkillActivations: (sessionId: string, uuid: string) => void
  clearPendingUserSkillActivations: (sessionId: string, uuid: string) => void
  queueMessage: (sessionId: string, text: string, rawText?: string, priority?: string, uuid?: string) => Promise<string>
}

// 执行当前源文件的真实方法；业务依赖保持显式、无副作用，避免导入 Electron 单例。
const source = readFileSync(new URL('./agent-orchestrator.ts', import.meta.url), 'utf8')
const methodStart = source.indexOf('  async queueMessage(')
const methodEnd = source.indexOf('\n  }\n}', methodStart) + '\n  }'.length
if (methodStart < 0 || methodEnd < methodStart) throw new Error('未找到真实 queueMessage 方法')
const transpiler = new Bun.Transpiler({ loader: 'ts' })
const queueClass = transpiler.transformSync(`class QueueSubject { ${source.slice(methodStart, methodEnd)} }`)
const createQueueClass = new Function('dependencies', `
  const {
    getAgentSessionMeta, getAgentWorkspace, browserController, buildDynamicContext,
    buildReferencedSessionsPrompt, buildReferencedPlanningPrompt, recallAutomaticMemory,
    randomUUID, appendSDKMessages, enqueueAutomaticMemory, isAgentSessionDeleting,
    isMissingActiveQueueChannelError, captureReferenceSnapshot,
  } = dependencies;
  ${queueClass}
  return QueueSubject;
`) as (dependencies: Record<string, unknown>) => new () => QueueSubject

const releaseStart = source.indexOf('    const releaseActiveRun = (): void => {')
const releaseEnd = source.indexOf('\n    const completeRun', releaseStart)
if (releaseStart < 0 || releaseEnd < releaseStart) throw new Error('未找到真实运行生命周期清理函数')
const releaseBody = transpiler.transformSync(`function cleanupRun(runGeneration: number) {
  const sessionId = 'session'
  ${source.slice(releaseStart, releaseEnd)}
  releaseActiveRun()
}`)
const releaseRun = new Function(`${releaseBody}; return cleanupRun`)() as (
  this: QueueSubject, runGeneration: number,
) => void

function fixture(sendQueuedMessage: QueueSubject['adapter']['sendQueuedMessage']) {
  const persisted: SDKMessage[] = []
  const clearedActivations: string[] = []
  const Subject = createQueueClass({
    // 本用例只验证队列运行代际；引用使用明确空快照，绝不读取真实用户配置。
    captureReferenceSnapshot: () => [],
    getAgentSessionMeta: () => undefined,
    getAgentWorkspace: () => undefined,
    browserController: { getUserContext: () => undefined },
    buildDynamicContext: () => '',
    buildReferencedSessionsPrompt: () => '',
    buildReferencedPlanningPrompt: () => '',
    recallAutomaticMemory: () => '',
    randomUUID: () => 'generated-message',
    appendSDKMessages: (_sessionId: string, messages: SDKMessage[]) => { persisted.push(...messages) },
    enqueueAutomaticMemory: () => {},
    isAgentSessionDeleting: () => false,
    isMissingActiveQueueChannelError: isStaleActiveQueueError,
  })
  const subject = Object.assign(new Subject(), {
    activeSessions: new Map([['session', 7]]),
    activeSessionStartedAt: new Map([['session', 100]]),
    sessionPermissionModes: new Map<string, GammaPermissionMode>([['session', 'bypassPermissions']]),
    queuedMessageUuids: new Map([['session', new Set(['earlier-message'])]]),
    adapter: { sendQueuedMessage },
    flushPendingUserSkillActivations: () => {},
    clearPendingUserSkillActivations: (_sessionId: string, uuid: string) => { clearedActivations.push(uuid) },
  })
  return { subject, persisted, clearedActivations }
}

describe('Given 注入通道失效但 Agent 运行生命周期仍存活', () => {
  test('When queueMessage 返回 stale Then 保留当前 generation、权限和运行槽位供 deferred queue 等待', async () => {
    const stale = Object.assign(new Error('Agent session is not active'), { code: 'agent.query.not_active' })
    const { subject, persisted, clearedActivations } = fixture(async () => { throw stale })
    await expect(subject.queueMessage('session', '继续任务', undefined, undefined, 'follow-up')).rejects.toBe(stale)
    expect(subject.activeSessions.get('session')).toBe(7)
    expect(subject.activeSessionStartedAt.get('session')).toBe(100)
    expect(subject.sessionPermissionModes.get('session')).toBe('bypassPermissions')
    expect(subject.queuedMessageUuids.get('session')).toEqual(new Set(['earlier-message']))
    expect(persisted).toEqual([])
    expect(clearedActivations).toEqual(['follow-up'])
    // 只有属于该 generation 的正常运行清理才释放状态。
    releaseRun.call(subject, 7)
    expect(subject.activeSessions.has('session')).toBe(false)
    expect(subject.sessionPermissionModes.has('session')).toBe(false)
  })

  test('When 旧注入在新 generation 开始后才返回 stale Then 旧请求和旧运行清理均不能释放新状态', async () => {
    let rejectInjection!: (error: unknown) => void
    const blocked = new Promise<void>((_resolve, reject) => { rejectInjection = reject })
    const { subject, persisted } = fixture(() => blocked)
    const pending = subject.queueMessage('session', '旧轮后续消息', undefined, undefined, 'old-follow-up')
    subject.activeSessions.set('session', 8)
    subject.activeSessionStartedAt.set('session', 200)
    subject.sessionPermissionModes.set('session', 'plan')
    subject.queuedMessageUuids.set('session', new Set(['new-run-message']))
    const stale = Object.assign(new Error('当前会话没有正在运行的 Agent'), { code: 'agent.query.not_active' })
    rejectInjection(stale)
    await expect(pending).rejects.toBe(stale)
    releaseRun.call(subject, 7)
    expect(subject.activeSessions.get('session')).toBe(8)
    expect(subject.activeSessionStartedAt.get('session')).toBe(200)
    expect(subject.sessionPermissionModes.get('session')).toBe('plan')
    expect(subject.queuedMessageUuids.get('session')).toEqual(new Set(['new-run-message']))
    expect(persisted).toEqual([])
    releaseRun.call(subject, 8)
    expect(subject.activeSessions.has('session')).toBe(false)
    expect(subject.activeSessionStartedAt.has('session')).toBe(false)
    expect(subject.sessionPermissionModes.has('session')).toBe(false)
    expect(subject.queuedMessageUuids.has('session')).toBe(false)
  })

  test('When 正常接收后续消息 Then 持久化一次并继续保留运行状态', async () => {
    const { subject, persisted } = fixture(async () => {})
    expect(await subject.queueMessage('session', '继续任务', '展示原文', undefined, 'follow-up')).toBe('follow-up')
    expect(persisted).toHaveLength(1)
    const persistedUser = persisted[0]
    if (persistedUser?.type !== 'user') throw new Error('后续消息没有持久化为用户输入')
    expect(persistedUser.uuid).toBe('follow-up')
    expect(subject.activeSessions.get('session')).toBe(7)
    expect(subject.sessionPermissionModes.get('session')).toBe('bypassPermissions')
  })
})
