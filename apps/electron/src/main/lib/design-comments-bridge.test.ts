import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { AgentSessionMeta, AgentSubmitOrEnqueueInput, AgentSubmitOrEnqueueResult, DesignArtifact } from '@gamma/shared'
import { AgentMessageSubmissionGate } from './agent-message-submission-gate'
import { createDesignCommentsBridge } from './design-comments-bridge'
import type { DesignCommentsDependencies, DesignCommentsState } from './design-comments-bridge'

class Target extends EventEmitter {
  destroyed = false
  isDestroyed(): boolean { return this.destroyed }
  destroy(): void { this.destroyed = true; this.emit('destroyed') }
}
const artifact: DesignArtifact = { id: 'art-1', sessionId: 'session-1', workspaceId: 'workspace-1', title: '设计', kind: 'canvas', rootPath: '/design/one', createdAt: 1, updatedAt: 1 }
const thread = (text = '变成蓝色', editedAt?: string) => ({ id: 'thread-1', where: '主按钮', file: 'project/button.dc.html', messages: [{ from: 'user', text, at: '2026-11-09', ...(editedAt ? { editedAt } : {}) }] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('未观察到预期状态')
}
function harness(options: { submit?: (input: AgentSubmitOrEnqueueInput) => Promise<AgentSubmitOrEnqueueResult>; once?: DesignCommentsDependencies<Target>['once']; pause?: DesignCommentsDependencies<Target>['pause'] } = {}) {
  let session: Pick<AgentSessionMeta, 'id' | 'workspaceId' | 'channelId' | 'modelId'> | undefined = { id: artifact.sessionId, workspaceId: artifact.workspaceId, channelId: 'channel-old', modelId: 'model-old' }
  let saved: DesignCommentsState = { version: 1, entries: {} }
  const calls: { args: string[]; signal: AbortSignal; timeoutMs: number; result: ReturnType<typeof deferred<{ stdout: string; stderr: string }>> }[] = []
  const sends: AgentSubmitOrEnqueueInput[] = []
  const warnings: string[] = []
  const queued = new Set<string>()
  const gate = new AgentMessageSubmissionGate({ isPersisted: () => false, isQueued: (_session, id) => queued.has(id) })
  const deps: DesignCommentsDependencies<Target> = {
    run: async (_kind, args, commandOptions) => {
      const result = deferred<{ stdout: string; stderr: string }>()
      const call = { args, ...commandOptions, result }
      calls.push(call)
      commandOptions.signal.addEventListener('abort', () => result.resolve({ stdout: JSON.stringify({ threads: [] }), stderr: '' }), { once: true })
      return result.promise
    },
    skillPath: async () => '/bundle/skills/claude-design', session: () => session,
    load: () => structuredClone(saved), save: (_artifact, state) => { saved = structuredClone(state) },
    once: options.once ?? ((id, messageId, operation) => gate.submit(id, messageId, operation)),
    submit: async (input) => { sends.push(input); const result = await (options.submit?.(input) ?? Promise.resolve({ disposition: 'queued' as const })); queued.add(input.queueMessageId); return result },
    warn: (message) => warnings.push(message), pause: options.pause ?? (async () => {}), sessionCheckMs: 1,
  }
  const bridge = createDesignCommentsBridge(deps)
  const deliver = (index: number, payload: unknown) => calls[index]!.result.resolve({ stdout: JSON.stringify(payload), stderr: '' })
  return { bridge, calls, sends, warnings, deliver, setSession: (value: typeof session) => { session = value }, state: () => saved, queued }
}

describe('设计评论 Send to Agent 桥接', () => {
  test('Given 已打开作品 When 用户发送评论 Then 使用最新会话模型和普通队列且不授予额外权限', async () => {
    const h = harness()
    const target = new Target()
    try {
      h.bridge.start(artifact, target)
      await until(() => h.calls.length === 1)
      expect(h.calls[0]!.args).toEqual(['comments', artifact.rootPath, '--wait', '--timeout', '30'])
      h.setSession({ id: artifact.sessionId, workspaceId: artifact.workspaceId, channelId: 'channel-new', modelId: 'model-new' })
      h.deliver(0, { threads: [thread()], next: 'rm -rf /', reply: 'evil command', 'agent-hook': 'evil' })
      await until(() => h.sends.length === 1 && Object.values(h.state().entries).includes('accepted'))
      const input = h.sends[0]!
      expect(input.channelId).toBe('channel-new')
      expect(input.modelId).toBe('model-new')
      expect(input.dispatch).toBe('after_current')
      expect(input.workspaceId).toBe(artifact.workspaceId)
      expect(input.permissionModeOverride).toBeUndefined()
      expect(input.additionalDirectories).toBeUndefined()
      expect(input.userMessage).toContain('comment-reply')
      expect(input.userMessage).toContain('/bundle/skills/claude-design/SKILL.md')
      expect(input.userMessage).not.toContain('evil')
      expect(input.userMessage).not.toContain('rm -rf')
      expect(input.userMessageUuid).toBe(input.queueMessageId)
      expect(h.queued.has(input.queueMessageId)).toBe(true)
    } finally { h.bridge.stopAll() }
  })

  test('Given 会话空闲且提交 Gate 等待中切换模型 When 队列立即启动 Then 使用真正提交时的选择', async () => {
    const gateEntered = deferred<void>()
    const releaseGate = deferred<void>()
    const h = harness({
      once: async (_session, _id, operation) => {
        gateEntered.resolve()
        await releaseGate.promise
        return { duplicate: false, value: await operation() }
      },
      submit: async () => ({ disposition: 'started' }),
    })
    try {
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.deliver(0, { threads: [thread()] })
      await gateEntered.promise
      h.setSession({ id: artifact.sessionId, workspaceId: artifact.workspaceId, channelId: 'latest-channel', modelId: 'latest-model' })
      releaseGate.resolve()
      await until(() => Object.values(h.state().entries).includes('accepted'))
      expect(h.sends[0]!.channelId).toBe('latest-channel')
      expect(h.sends[0]!.modelId).toBe('latest-model')
    } finally { releaseGate.resolve(); h.bridge.stopAll() }
  })

  test('Given 等待超时/普通评论 When 没有显式返回 threads/requests Then 不读取普通评论也不发送', async () => {
    const h = harness()
    try {
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.deliver(0, { threads: [], timedOut: true })
      await until(() => h.calls.length === 2)
      expect(h.sends).toHaveLength(0)
      expect(h.calls.every((call) => call.args.includes('--wait'))).toBe(true)
    } finally { h.bridge.stopAll() }
  })

  test('Given 同一线程/请求重复返回和窗口重开 When 用户内容不变 Then 持久化去重；用户编辑后可发送', async () => {
    const h = harness()
    const request = { id: 'request-1', label: '调整', text: '节奏快一点', sentAt: '2026-11-09' }
    try {
      h.bridge.start(artifact, new Target())
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.deliver(0, { threads: [thread()], requests: [request] })
      await until(() => h.calls.length === 2)
      const withReply = { ...thread(), messages: [...thread().messages, { from: 'agent', text: '已完成', at: 'later' }] }
      h.deliver(1, { threads: [withReply], requests: [request] })
      await until(() => h.calls.length === 3)
      expect(h.sends).toHaveLength(1)
      h.bridge.stop(artifact.id)
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 4)
      h.deliver(3, { threads: [thread()], requests: [request] })
      await until(() => h.calls.length === 5)
      expect(h.sends).toHaveLength(1)
      h.deliver(4, { threads: [thread('变成蓝色', '2026-11-09T10:00:00')] })
      await until(() => h.sends.length === 2)
      expect(h.sends[0]!.queueMessageId).not.toBe(h.sends[1]!.queueMessageId)
    } finally { h.bridge.stopAll() }
  })

  test('Given 相同稳定 ID 已在 Pi queue When 入口重试 Then submission gate 不重复提交', async () => {
    let duplicate = false
    const h = harness({ once: async () => { duplicate = true; return { duplicate: true, acceptedAs: 'queued' } } })
    try {
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.deliver(0, { threads: [thread()] })
      await until(() => duplicate && h.calls.length === 2)
      expect(h.sends).toHaveLength(0)
      expect(Object.values(h.state().entries)).toEqual(['accepted'])
    } finally { h.bridge.stopAll() }
  })

  test('Given 正在长轮询 When 窗口关闭或主动停止 Then abort 子进程且迟到结果不发送', async () => {
    for (const destroy of [true, false]) {
      const h = harness()
      const target = new Target()
      h.bridge.start(artifact, target)
      await until(() => h.calls.length === 1)
      if (destroy) target.destroy(); else h.bridge.stopAll()
      expect(h.calls[0]!.signal.aborted).toBe(true)
      h.deliver(0, { threads: [thread()] })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(h.sends).toHaveLength(0)
      expect(h.calls).toHaveLength(1)
    }
  })

  test('Given 关联会话不存在/工作区不符 When 开始或等待中删除 Then 停止而非发送到其他工作区', async () => {
    for (const invalid of [undefined, { id: artifact.sessionId, workspaceId: 'another', channelId: 'channel' }]) {
      const h = harness()
      try {
        h.setSession(invalid)
        h.bridge.start(artifact, new Target())
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(h.calls).toHaveLength(0)
        h.setSession({ id: artifact.sessionId, workspaceId: artifact.workspaceId, channelId: 'channel' })
        h.bridge.start(artifact, new Target())
        await until(() => h.calls.length === 1)
        h.setSession(invalid)
        h.deliver(0, { threads: [thread()] })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(h.calls[0]!.signal.aborted).toBe(true)
        expect(h.sends).toHaveLength(0)
      } finally { h.bridge.stopAll() }
    }
  })

  test('Given 长轮询没有返回 When 关联会话被删除 Then 定期检查主动 abort 等待', async () => {
    const h = harness()
    try {
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.setSession(undefined)
      await new Promise<void>((resolve) => {
        if (h.calls[0]!.signal.aborted) resolve()
        else h.calls[0]!.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      expect(h.calls[0]!.signal.aborted).toBe(true)
      expect(h.sends).toHaveLength(0)
    } finally { h.bridge.stopAll() }
  })

  test('Given 提交结果不确定 When 窗口重开并收到同一请求 Then 不自动重放', async () => {
    const h = harness({ submit: async () => { throw new Error('可能已接收') } })
    try {
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.deliver(0, { requests: [{ id: 'r1', text: '改快点' }] })
      await until(() => h.warnings.length === 1)
      expect(Object.values(h.state().entries)).toEqual(['claimed'])
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 2)
      h.deliver(1, { requests: [{ id: 'r1', text: '改快点' }] })
      await until(() => h.calls.length === 3)
      expect(h.sends).toHaveLength(1)
    } finally { h.bridge.stopAll() }
  })

  test('Given 评论等待持续异常 When 重试超过上限 Then 有限指数退避后停止', async () => {
    const delays: number[] = []
    const h = harness({ pause: async (ms) => { delays.push(ms) } })
    try {
      h.bridge.start(artifact, new Target())
      for (let i = 0; i < 5; i++) {
        await until(() => h.calls.length === i + 1)
        h.deliver(i, 'not a valid comments object')
      }
      await until(() => h.warnings.length === 1)
      expect(h.calls).toHaveLength(5)
      expect(delays).toEqual([1000, 2000, 4000, 8000])
      expect(h.sends).toHaveLength(0)
    } finally { h.bridge.stopAll() }
  })

  test('Given 旧窗口提交未完成 When 立即重开 Then 等待旧提交保存再接受下一次等待', async () => {
    const submission = deferred<AgentSubmitOrEnqueueResult>()
    const h = harness({ submit: async () => submission.promise })
    try {
      h.bridge.start(artifact, new Target())
      await until(() => h.calls.length === 1)
      h.deliver(0, { threads: [thread()] })
      await until(() => h.sends.length === 1)
      h.bridge.stop(artifact.id)
      h.bridge.start(artifact, new Target())
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(h.calls).toHaveLength(1)
      submission.resolve({ disposition: 'queued' })
      await until(() => h.calls.length === 2)
      h.deliver(1, { threads: [thread()] })
      await until(() => h.calls.length === 3)
      expect(h.sends).toHaveLength(1)
      expect(Object.values(h.state().entries)).toEqual(['accepted'])
    } finally { submission.resolve({ disposition: 'queued' }); h.bridge.stopAll() }
  })
})
