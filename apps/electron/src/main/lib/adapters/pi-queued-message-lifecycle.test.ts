import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentSession, ResourceLoader } from '@earendil-works/pi-coding-agent'
import { Agent } from '@earendil-works/pi-agent-core'
import type { SDKMessage, SDKUserMessageInput } from '@gamma/shared'
import { PiAgentAdapter, PiQueuedMessageAdmissionGate, PiQueuedMessageReceiptTracker, recoverUnconsumedPiQueuedMessages } from './pi-agent-adapter'
import { PendingPromptSkillActivationTracker } from './pi-skill-activation-tracker'
import { isStaleActiveQueueError } from '../agent-queue-routing'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const message: SDKUserMessageInput = {
  type: 'user', message: { role: 'user', content: '继续检查电脑工具' },
  parent_tool_use_id: null, priority: 'now', uuid: 'follow-up', session_id: 'session',
}

function fixture() {
  const calls: string[] = []
  const runErrors: unknown[] = []
  const agent = new Agent({ streamFn: () => { throw new Error('本地队列夹具不应请求模型') } })
  const session = {
    steer: async (text: string) => { calls.push(text) },
    followUp: async (text: string) => { calls.push(text) },
    agent,
  } as unknown as AgentSession
  const active = {
    ready: Promise.resolve(session),
    session,
    abortRequested: false,
    disposed: false,
    pendingInterruptPrompts: [],
    pendingSkillActivations: new PendingPromptSkillActivationTracker(),
    queuedMessageAdmission: new PiQueuedMessageAdmissionGate(),
    queuedMessageReceipts: new PiQueuedMessageReceiptTracker(agent, (error) => { runErrors.push(error) }),
    resourceLoader: undefined as ResourceLoader | undefined,
  }
  const adapter = new PiAgentAdapter()
  // 只替换 SDK 会话边界，提交逻辑执行真实适配器方法。
  const sessions = (adapter as unknown as { activeSessions: Map<string, typeof active> }).activeSessions
  sessions.set('session', active)
  return { adapter, active, session, sessions, calls, runErrors }
}

describe('Given Pi 运行期间追加消息', () => {
  test('When 会话正常运行 Then 只向当前 SDK 通道注入一次', async () => {
    const { adapter, calls } = fixture()
    await adapter.sendQueuedMessage('session', message)
    expect(calls).toEqual(['继续检查电脑工具'])
  })

  test('When 等待 ready 期间旧运行已结束 Then 返回可排队的失效通道错误', async () => {
    const { adapter, active, session, sessions, calls } = fixture()
    const ready = deferred<AgentSession>()
    active.ready = ready.promise
    const pending = adapter.sendQueuedMessage('session', message)
    active.disposed = true
    sessions.delete('session')
    ready.resolve(session)
    const error = await pending.then(() => undefined, (failure: unknown) => failure)
    expect(isStaleActiveQueueError(error)).toBe(true)
    expect(calls).toEqual([])
  })

  test('When Skill reload 期间运行结束 Then 不向已释放会话假发送', async () => {
    const { adapter, active, sessions, calls } = fixture()
    const entered = deferred<void>()
    const reload = deferred<void>()
    active.resourceLoader = {
      reload: async () => { entered.resolve(); await reload.promise },
    } as unknown as ResourceLoader
    const pending = adapter.sendQueuedMessage('session', message)
    await entered.promise
    active.disposed = true
    sessions.delete('session')
    reload.resolve()
    const error = await pending.then(() => undefined, (failure: unknown) => failure)
    expect(isStaleActiveQueueError(error)).toBe(true)
    expect(calls).toEqual([])
  })

  test('When reload 期间同一会话开始新运行 Then 旧提交不能越界注入新运行', async () => {
    const { adapter, active, sessions, calls } = fixture()
    const entered = deferred<void>()
    const reload = deferred<void>()
    active.resourceLoader = {
      reload: async () => { entered.resolve(); await reload.promise },
    } as unknown as ResourceLoader
    const pending = adapter.sendQueuedMessage('session', message)
    await entered.promise
    sessions.set('session', { ...active })
    reload.resolve()
    const error = await pending.then(() => undefined, (failure: unknown) => failure)
    expect(isStaleActiveQueueError(error)).toBe(true)
    expect(calls).toEqual([])
  })

  test('When SDK 等待期间运行已失败释放且消息尚未消费 Then 晚到的入队返回 stale 供主进程排队', async () => {
    const { adapter, active, session, sessions, runErrors } = fixture()
    const entered = deferred<void>()
    const resume = deferred<void>()
    session.steer = async (text) => {
      entered.resolve()
      await resume.promise
      session.agent.steer({ role: 'user', content: text, timestamp: 1 })
      return 'queued'
    }
    const pending = adapter.sendQueuedMessage('session', message)
    await entered.promise
    active.disposed = true
    sessions.delete('session')
    resume.resolve()
    const error = await pending.then(() => undefined, (failure: unknown) => failure)
    expect(isStaleActiveQueueError(error)).toBe(true)
    expect(session.agent.state.messages).toEqual([])
    expect(runErrors).toEqual([])
  })

  test('When SDK 已消费消息后运行释放且入队 Promise 抛错 Then 保留接收状态避免重发已消费输入', async () => {
    const { adapter, active, session, sessions, runErrors } = fixture()
    const originalError = new Error('SDK 在消费消息之后退出')
    session.steer = async (text) => {
      const consumed = { role: 'user' as const, content: text, timestamp: 1 }
      session.agent.steer(consumed)
      session.agent.state.messages = [consumed]
      active.disposed = true
      sessions.delete('session')
      throw originalError
    }
    let accepted = 0
    await adapter.sendQueuedMessage('session', message, { onAccepted: () => { accepted += 1 } })
    expect(accepted).toBe(1)
    expect(session.agent.state.messages).toHaveLength(1)
    expect(runErrors).toEqual([originalError])
  })

  test('When input hook 主动处理消息且未入队 Then 保留 SDK 原有的成功接收语义', async () => {
    const { adapter, active, session, sessions } = fixture()
    session.steer = async () => {
      active.disposed = true
      sessions.delete('session')
      return 'handled'
    }
    await adapter.sendQueuedMessage('session', message)
    expect(session.agent.state.messages).toEqual([])
  })

  test('When SDK 的 input hook 还在等待而 prompt 已完成 Then 等待入队并回收未消费消息续跑', async () => {
    const { adapter, active, session } = fixture()
    const entered = deferred<void>()
    const releaseInput = deferred<void>()
    const steering: string[] = []
    session.steer = async (text: string) => {
      entered.resolve()
      await releaseInput.promise
      steering.push(text)
      return 'queued'
    }
    const queue = {
      get pendingMessageCount() { return steering.length },
      clearQueue() { return { steering: steering.splice(0), followUp: [] } },
    }
    const sending = adapter.sendQueuedMessage('session', message)
    await entered.promise
    let closed = false
    const recovering = recoverUnconsumedPiQueuedMessages(active.queuedMessageAdmission, queue, () => true)
      .then((messages) => { closed = true; return messages })
    await Promise.resolve()
    expect(closed).toBe(false)
    releaseInput.resolve()
    await sending
    expect(await recovering).toEqual(['继续检查电脑工具'])
    expect(steering).toEqual([])
    expect(isStaleActiveQueueError(await adapter.sendQueuedMessage('session', message)
      .then(() => undefined, (error: unknown) => error))).toBe(true)
  })

  test('When 关闭接收时又有一次入队开始 Then 继续等待全部入队后才收尾', async () => {
    const admission = new PiQueuedMessageAdmissionGate()
    const first = deferred<void>()
    const second = deferred<void>()
    const firstAdmission = admission.admit(() => first.promise)
    let closed = false
    const closing = admission.drainAndClose().then(() => { closed = true })
    const secondAdmission = admission.admit(() => second.promise)
    first.resolve()
    await firstAdmission
    await Promise.resolve()
    expect(closed).toBe(false)
    second.resolve()
    await Promise.all([closing, secondAdmission])
    expect(() => admission.assertOpen()).toThrow('当前会话没有正在运行的 Agent')
  })

  test('When SDK 入队失败 Then 不回收消息且不阻塞运行收尾', async () => {
    const admission = new PiQueuedMessageAdmissionGate()
    const failed = admission.admit(async () => { throw new Error('input hook 失败') })
    const closing = admission.drainAndClose()
    await expect(failed).rejects.toThrow('input hook 失败')
    await closing
    expect(() => admission.assertOpen()).toThrow()
  })

  test('When 用户停止或达到运行限制 Then 已停止的任务不会被回收消息重新启动', async () => {
    const admission = new PiQueuedMessageAdmissionGate()
    let cleared = false
    expect(await recoverUnconsumedPiQueuedMessages(admission, {
      pendingMessageCount: 1,
      clearQueue() { cleared = true; return { steering: ['后续任务'], followUp: [] } },
    }, () => false)).toEqual([])
    expect(cleared).toBe(false)
    expect(() => admission.assertOpen()).toThrow()
  })

  test('When 同一 query 确定还有续跑 prompt Then 重新打开接收后可继续注入', async () => {
    const { adapter, active, calls } = fixture()
    await active.queuedMessageAdmission.drainAndClose()
    active.queuedMessageAdmission.reopen()
    await adapter.sendQueuedMessage('session', message)
    expect(calls).toEqual(['继续检查电脑工具'])
  })

  test('When dispose 后旧 SDK 才入队 Then 保留回执直到旧提交退出并恢复原方法，不污染新 Agent', async () => {
    const oldAgent = new Agent({ streamFn: () => { throw new Error('不应请求模型') } })
    const newAgent = new Agent({ streamFn: () => { throw new Error('不应请求模型') } })
    const originalSteer = oldAgent.steer
    const tracker = new PiQueuedMessageReceiptTracker(oldAgent, () => {})
    const nextTracker = new PiQueuedMessageReceiptTracker(newAgent, () => {})
    const newSteer = newAgent.steer
    const entered = deferred<void>()
    const resume = deferred<void>()
    const pending = tracker.submit(async () => {
      entered.resolve()
      await resume.promise
      oldAgent.steer({ role: 'user', content: '旧消息', timestamp: 1 })
    }, () => false)
    await entered.promise
    tracker.dispose()
    expect(oldAgent.steer).not.toBe(originalSteer)
    resume.resolve()
    expect(isStaleActiveQueueError(await pending.then(() => undefined, (error: unknown) => error))).toBe(true)
    expect(oldAgent.steer).toBe(originalSteer)
    expect(newAgent.steer).toBe(newSteer)
    expect(newAgent.hasQueuedMessages()).toBe(false)
    nextTracker.dispose()
  })

  test('When 其他所有者已替换 core 方法 Then 旧 tracker dispose 不覆盖较新的方法', () => {
    const agent = new Agent({ streamFn: () => { throw new Error('不应请求模型') } })
    const tracker = new PiQueuedMessageReceiptTracker(agent, () => {})
    const replacement: Agent['steer'] = () => {}
    agent.steer = replacement
    tracker.dispose()
    expect(agent.steer).toBe(replacement)
  })

  test('When 真实 Pi prompt 结束后 SDK 才完成入队 Then 同一 query 续跑一次并保留最终完成信号', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-pi-queue-'))
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    const firstRequest = deferred<void>()
    const firstResponse = deferred<void>()
    const inputEntered = deferred<void>()
    const releaseInput = deferred<void>()
    const settling = deferred<void>()
    const adapter = new PiAgentAdapter()
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        requests.push(await request.json() as typeof requests[number])
        const round = requests.length
        if (round === 1) { firstRequest.resolve(); await firstResponse.promise }
        const chunks = [
          { id: `response-${round}`, object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: `第 ${round} 轮完成` }, finish_reason: null }] },
          { id: `response-${round}`, object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ]
        return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })
    const events: SDKMessage[] = []
    const consuming = (async () => {
      for await (const event of adapter.query({
        sessionId: 'session', prompt: '第一轮本地模拟任务',
        model: 'fixture', provider: 'openai', apiKey: 'fixture',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        cwd: directory, piAgentDir: join(directory, 'agent'), piSessionDir: join(directory, 'sessions'),
        systemPrompt: '本地测试', permissionMode: 'bypassPermissions',
      })) events.push(event)
    })()
    consuming.catch(() => {})
    try {
      await firstRequest.promise
      const active = (adapter as unknown as {
        activeSessions: Map<string, { session: AgentSession; queuedMessageAdmission: PiQueuedMessageAdmissionGate }>
      }).activeSessions.get('session')!
      const steer = active.session.steer.bind(active.session)
      active.session.steer = async (...args) => {
        inputEntered.resolve()
        await releaseInput.promise
        return await steer(...args)
      }
      const drain = active.queuedMessageAdmission.drainAndClose.bind(active.queuedMessageAdmission)
      active.queuedMessageAdmission.drainAndClose = async () => { settling.resolve(); await drain() }
      const sending = adapter.sendQueuedMessage('session', message)
      await inputEntered.promise
      firstResponse.resolve()
      await settling.promise
      releaseInput.resolve()
      await sending
      await consuming
      expect(requests).toHaveLength(2)
      expect(requests[1]!.messages.filter((entry) => entry.role === 'user')).toHaveLength(2)
      expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('继续检查电脑工具')
      expect(events.filter((event) => event.type === 'assistant')).toHaveLength(2)
      expect(events.filter((event) => event.type === 'result')).toHaveLength(1)
    } finally {
      firstResponse.resolve()
      releaseInput.resolve()
      adapter.abort('session')
      adapter.dispose()
      await server.stop(true)
      await consuming.catch(() => {})
      rmSync(directory, { recursive: true, force: true })
    }
  }, 20_000)

  test('When 真实 Pi 已持久化用户输入后提交报错 Then 提交保持成功且恢复历史中的输入只出现一次', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-pi-accepted-'))
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    const firstRequest = deferred<void>()
    const releaseResponse = deferred<void>()
    const queued = deferred<void>()
    const consumed = deferred<void>()
    const releaseError = deferred<void>()
    const failure = new Error('SDK 在已消费用户输入后退出')
    const adapter = new PiAgentAdapter()
    let sdkSessionId = ''
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        requests.push(await request.json() as typeof requests[number])
        if (requests.length === 1) { firstRequest.resolve(); await releaseResponse.promise }
        const chunk = { id: 'response', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: '本地完成' }, finish_reason: 'stop' }] }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    const input = {
      sessionId: 'session', prompt: '第一轮本地模拟任务', model: 'fixture', provider: 'openai' as const,
      apiKey: 'fixture', baseUrl: `http://127.0.0.1:${server.port}/v1`, cwd: directory,
      piAgentDir: join(directory, 'agent'), piSessionDir: join(directory, 'sessions'),
      systemPrompt: '本地测试', permissionMode: 'bypassPermissions' as const,
      onSessionId: (id: string) => { sdkSessionId = id },
    }
    const consuming = (async () => { for await (const _event of adapter.query(input)) { /* 消费真实 query */ } })()
    const queryFailure = consuming.then(() => undefined, (error: unknown) => error)
    try {
      await firstRequest.promise
      const active = (adapter as unknown as { activeSessions: Map<string, { session: AgentSession }> }).activeSessions.get('session')!
      active.session.agent.subscribe((event) => {
        if (event.type === 'message_end' && event.message.role === 'user' && JSON.stringify(event.message.content).includes('继续检查电脑工具')) consumed.resolve()
      })
      const steer = active.session.steer.bind(active.session)
      active.session.steer = async (...args) => {
        await steer(...args)
        queued.resolve()
        await releaseError.promise
        throw failure
      }
      let accepted = 0
      const sending = adapter.sendQueuedMessage('session', message, { onAccepted: () => { accepted += 1 } })
      await queued.promise
      releaseResponse.resolve()
      await consumed.promise
      adapter.dispose()
      releaseError.resolve()
      await sending
      expect(accepted).toBe(1)
      expect(await queryFailure).toBe(failure)
      const requestsBeforeResume = requests.length
      for await (const _event of adapter.query({ ...input, prompt: '恢复后继续', resumeSessionId: sdkSessionId })) { /* 验证恢复历史 */ }
      expect(requests).toHaveLength(requestsBeforeResume + 1)
      const recoveredUsers = requests.at(-1)!.messages.filter((entry) => entry.role === 'user')
      expect(recoveredUsers.filter((entry) => JSON.stringify(entry.content).includes('继续检查电脑工具'))).toHaveLength(1)
    } finally {
      releaseResponse.resolve()
      releaseError.resolve()
      adapter.abort('session')
      adapter.dispose()
      await server.stop(true)
      await queryFailure
      rmSync(directory, { recursive: true, force: true })
    }
  }, 20_000)
})
