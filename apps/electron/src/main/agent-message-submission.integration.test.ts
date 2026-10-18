import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { WebContents } from 'electron'
import type { AgentActiveSessionSnapshot, AgentExternalRunSource, AgentSendInput, AgentSendResult } from '@gamma/shared'
import { AgentMessageSubmissionGate } from './lib/agent-message-submission-gate'
import { AgentQueueCoordinator } from './lib/agent-queue-coordinator'
import { isStaleActiveQueueError } from './lib/agent-queue-routing'
import { AgentStreamRouteRegistry } from './lib/agent-stream-route-registry'
import { shouldStopBeforeAgentRun } from './lib/agent-stop-policy'
import { sendAgentStreamComplete } from './lib/agent-completion-payload'

interface TestSender {
  id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}
interface RunInput extends AgentSendInput { runGeneration?: number; queueMessageId?: string }
interface RunCallbacks {
  onRunStarted(input: { startedAt: number; runGeneration: number }): void
  onComplete(messages: never[], options: { startedAt: number; runGeneration: number; stoppedByUser: boolean }): void
}
interface ControlledRun { input: RunInput; finishModel: (stoppedByUser?: boolean) => void; finishCleanup: () => void }
type SendHandler = (event: { sender: TestSender }, input: AgentSendInput) => Promise<AgentSendResult>
interface HeadlessCallbacks { onError(error: string): void; onComplete(): void; onTitleUpdated(title: string): void; source?: AgentExternalRunSource }
interface ProductionService {
  runAgent(input: RunInput, sender: TestSender): Promise<void>
  runAgentHeadless(input: RunInput, callbacks: HeadlessCallbacks): Promise<void>
  stopAgent(sessionId: string): void
  listActiveAgentSessionSnapshots(): AgentActiveSessionSnapshot[]
  rebindActiveAgentStreams(sender: TestSender): AgentActiveSessionSnapshot[]
}

function productionFunction(source: string, name: string): string {
  const declaration = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0]
  if (!declaration) throw new Error(`未找到生产函数 ${name}`)
  return declaration.replace(/^export /, '')
}

/** 执行真实 IPC、service、幂等门禁、队列及流路由，仅替换 Electron 和模型进程。 */
function createSubmissionHarness(options: { holdMirror?: boolean; holdPreflight?: boolean; failFirstRouteRegistration?: boolean; failFirstHeadlessTarget?: boolean } = {}) {
  const ipcSource = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8')
  const registration = ipcSource.match(/  ipcMain\.handle\(\s*AGENT_IPC_CHANNELS\.SEND_MESSAGE,[\s\S]*?\n  \)/)?.[0]
  if (!registration) throw new Error('未找到生产 SEND_MESSAGE IPC 注册入口')
  const serviceSource = readFileSync(new URL('./lib/agent-service.ts', import.meta.url), 'utf8')
  const source = [
    productionFunction(serviceSource, 'reserveAgentSessionStart'),
    productionFunction(serviceSource, 'runAgent'),
    productionFunction(serviceSource, 'runAgentHeadless'),
    productionFunction(serviceSource, 'stopAgent'),
    productionFunction(serviceSource, 'listActiveAgentSessionSnapshots'),
    productionFunction(serviceSource, 'rebindActiveAgentStreams'),
    productionFunction(serviceSource, 'getStreamRouteTargets'),
    productionFunction(serviceSource, 'submitOrEnqueueAgentMessage'),
    registration,
    'return { runAgent, runAgentHeadless, stopAgent, listActiveAgentSessionSnapshots, rebindActiveAgentStreams }',
  ].join('\n').replace("await import('./feishu-bridge-manager')", 'await loadFeishuBridgeManager()')
  let active = false
  let activeSnapshot: AgentActiveSessionSnapshot | undefined
  let generation = 0
  let handler: SendHandler | undefined
  let dispatchHook: (() => void) | undefined
  let runAgent: ((input: RunInput, sender: TestSender) => Promise<void>) | undefined
  const startingAgentSessions = new Set<string>()
  const preparingAgentSessions = new Set<string>()
  const persistedIds = new Set<string>()
  const runs: ControlledRun[] = []
  const lifecycle: string[] = []
  const stops: boolean[] = []
  const deliveries: { targetId: number; payload: unknown }[] = []
  const mirrorReady = Promise.withResolvers<void>()
  const preflightReady = Promise.withResolvers<void>()
  if (!options.holdMirror) mirrorReady.resolve()
  if (!options.holdPreflight) preflightReady.resolve()
  const createSender = (id: number): TestSender => ({ id, isDestroyed: () => false, send: (_channel, payload) => { deliveries.push({ targetId: id, payload }) } })
  const sender = createSender(1)
  const streamRoutes = new AgentStreamRouteRegistry<TestSender>()
  const coordinator = new AgentQueueCoordinator({
    isActive: () => active || startingAgentSessions.has('session'),
    getWebContents: () => sender as unknown as WebContents,
    reserveRunGeneration: () => ++generation,
    sendStarted: () => dispatchHook?.(),
    startRun: (input) => {
      if (!runAgent) throw new Error('生产 runAgent 未加载')
      return runAgent(input, sender)
    },
  })
  const gate = new AgentMessageSubmissionGate({
    isPersisted: (_sessionId, messageId) => persistedIds.has(messageId),
    isQueued: (sessionId, messageId) => coordinator.isDispatchingMessage(sessionId, messageId)
      || coordinator.snapshot(sessionId).some(({ input }) => input.queueMessageId === messageId),
  })
  const dependencies = {
    randomUUID,
    console: { error: () => undefined, warn: () => undefined },
    ipcMain: { handle: (_channel: string, callback: SendHandler) => { handler = callback } },
    AGENT_IPC_CHANNELS: { SEND_MESSAGE: 'agent:send-message', STREAM_ERROR: 'agent:stream-error' },
    submitAgentMessageOnce: gate.submit.bind(gate),
    startingAgentSessions,
    preparingAgentSessions,
    pendingAgentSessionSnapshots: new Map<string, AgentActiveSessionSnapshot>(),
    shouldStopBeforeAgentRun,
    agentQueueCoordinator: coordinator,
    streamRoutes,
    streamForwarder: { clear: () => { lifecycle.push('clear-stream') } },
    eventBus: { emit: () => undefined },
    registerWebContents: (sessionId: string, target: TestSender) => {
      if (options.failFirstRouteRegistration) {
        options.failFirstRouteRegistration = false
        throw new Error('模拟 renderer 注册流路由失败')
      }
      return streamRoutes.bind(sessionId, target)
    },
    rebindWebContents: (sessionId: string, target: TestSender) => streamRoutes.rebind(sessionId, target),
    updateAgentSessionMeta: () => undefined,
    getAgentSessionMeta: () => ({ id: 'session' }),
    getSessionMetaForRenderer: () => ({ id: 'session' }),
    getMainRendererWebContents: () => sender,
    getHeadlessAgentRunTarget: () => {
      if (options.failFirstHeadlessTarget) {
        options.failFirstHeadlessTarget = false
        throw new Error('模拟 headless 目标解析失败')
      }
      return sender
    },
    publishRunStopped: () => undefined,
    sendAgentStreamComplete,
    attachWebContentsCleanup: () => undefined,
    feishuBridgeManager: { startSessionMirrorRun: () => mirrorReady.promise },
    loadFeishuBridgeManager: async () => ({ feishuBridgeManager: { startSessionMirrorRun: () => mirrorReady.promise } }),
    isStaleActiveQueueError,
    queueAgentMessage: async () => { throw new Error('下一轮消息不应直接注入当前轮') },
    orchestrator: {
      isActive: () => active,
      reserveRunGeneration: () => ++generation,
      listActiveSessionSnapshots: () => activeSnapshot ? [activeSnapshot] : [],
      stop: (_sessionId: string, stopBeforeRun: boolean) => { stops.push(stopBeforeRun) },
      sendMessage: async (input: RunInput, callbacks: RunCallbacks) => {
        await preflightReady.promise
        const modelDone = Promise.withResolvers<void>()
        const cleanupDone = Promise.withResolvers<void>()
        let stoppedByUser = false
        active = true
        lifecycle.push(`start:${input.userMessageUuid}`)
        if (input.userMessageUuid) persistedIds.add(input.userMessageUuid)
        runs.push({ input, finishModel: (stopped = false) => { stoppedByUser = stopped; modelDone.resolve() }, finishCleanup: () => cleanupDone.resolve() })
        const runGeneration = input.runGeneration ?? ++generation
        const startedAt = input.startedAt ?? Date.now()
        activeSnapshot = { sessionId: input.sessionId, startedAt, runGeneration }
        callbacks.onRunStarted({ startedAt, runGeneration })
        await modelDone.promise
        active = false
        activeSnapshot = undefined
        callbacks.onComplete([], { startedAt, runGeneration, stoppedByUser })
        await cleanupDone.promise
        lifecycle.push(`cleanup:${input.userMessageUuid}`)
      },
    },
  }
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const execute = new Function(...Object.keys(dependencies), transpiler.transformSync(source))
  const service = execute(...Object.values(dependencies)) as ProductionService
  runAgent = service.runAgent
  if (!handler) throw new Error('生产 SEND_MESSAGE 未注册 handler')
  const sendHandler: SendHandler = handler
  return {
    send: (input: AgentSendInput) => sendHandler({ sender }, input),
    startDesktop: (input: RunInput) => service.runAgent(input, sender),
    releaseMirror: () => mirrorReady.resolve(),
    releasePreflight: () => preflightReady.resolve(),
    startHeadless: (input: RunInput, callbacks: HeadlessCallbacks) => service.runAgentHeadless(input, callbacks),
    stop: () => service.stopAgent('session'),
    onDispatchReserved: (callback: () => void) => { dispatchHook = callback },
    runs,
    lifecycle,
    stops,
    deliveries,
    snapshots: () => service.listActiveAgentSessionSnapshots(),
    reload: () => service.rebindActiveAgentStreams(createSender(2)),
    isReserved: () => startingAgentSessions.has('session') || preparingAgentSessions.has('session'),
    queue: () => coordinator.snapshot('session'),
    async dispose() {
      mirrorReady.resolve()
      preflightReady.resolve()
      for (let pass = 0; pass < 8; pass++) {
        for (const run of runs) { run.finishModel(); run.finishCleanup() }
        await flushSubmissionMicrotasks()
      }
    },
  }
}
function message(id: string): AgentSendInput {
  return { sessionId: 'session', userMessageUuid: id, userMessage: `消息 ${id}`, channelId: 'channel', modelId: 'model' }
}
/** 清空已排定的 Promise 链，不通过超时等待整轮 Agent 执行。 */
async function flushSubmissionMicrotasks(): Promise<void> {
  for (let count = 0; count < 40; count++) await Promise.resolve()
}
function observeSend(pending: Promise<AgentSendResult>) {
  const observation: { result?: AgentSendResult; failure?: unknown } = {}
  void pending.then((result) => { observation.result = result }, (failure: unknown) => { observation.failure = failure })
  return observation
}

describe('Given renderer 经真实 SEND_MESSAGE IPC 提交到主进程', () => {
  test('When 首条消息已接受且 Agent 仍在运行 Then IPC 回执不等待整轮任务结束', async () => {
    const harness = createSubmissionHarness()
    try {
      const submission = observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      expect(harness.runs).toHaveLength(1)
      expect(submission.failure).toBeUndefined()
      expect(submission.result).toEqual({ disposition: 'sent' })
      expect(harness.lifecycle).toEqual(['start:first'])
    } finally { await harness.dispose() }
  })
  test('When 首轮仍在运行时发送第二条 Then 快速接收入队，避免运行中发送报错', async () => {
    const harness = createSubmissionHarness()
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      const second = observeSend(harness.send(message('second')))
      await flushSubmissionMicrotasks()
      expect(second.failure).toBeUndefined()
      expect(second.result).toEqual({ disposition: 'sent' })
      expect(harness.runs).toHaveLength(1)
      expect(harness.queue().map(({ input }) => input.queueMessageId)).toEqual(['second'])
    } finally { await harness.dispose() }
  })
  test('When 飞书镜像初始化尚未完成 Then 首条和后续消息均获得回执，后续消息保持队列顺序', async () => {
    const harness = createSubmissionHarness({ holdMirror: true })
    try {
      const first = observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      const second = observeSend(harness.send(message('second')))
      await flushSubmissionMicrotasks()
      expect(first.result).toEqual({ disposition: 'sent' })
      expect(second.failure).toBeUndefined()
      expect(second.result).toEqual({ disposition: 'sent' })
      expect(harness.runs).toHaveLength(0)
      expect(harness.queue().map(({ input }) => input.queueMessageId)).toEqual(['second'])
      harness.releaseMirror()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first'])
    } finally { await harness.dispose() }
  })
  test('When 两个窗口重复提交稳定 ID Then 已持久化或正在排队的消息均仅执行一次', async () => {
    const harness = createSubmissionHarness()
    try {
      const first = observeSend(harness.send(message('first')))
      const duplicate = observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      expect(first.result).toEqual({ disposition: 'sent' })
      expect(duplicate.result).toEqual({ disposition: 'already_accepted' })
      const next = observeSend(harness.send(message('next')))
      const nextDuplicate = observeSend(harness.send(message('next')))
      await flushSubmissionMicrotasks()
      expect(next.result).toEqual({ disposition: 'sent' })
      expect(nextDuplicate.result).toEqual({ disposition: 'already_accepted' })
      expect(harness.runs).toHaveLength(1)
      expect(harness.queue().map(({ input }) => input.queueMessageId)).toEqual(['next'])
    } finally { await harness.dispose() }
  })
  test('When 模型已结束但旧轮仍在清理 Then 等待清理完成后按 FIFO 接力且不被旧轮清空流路由', async () => {
    const harness = createSubmissionHarness()
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      observeSend(harness.send(message('second')))
      observeSend(harness.send(message('third')))
      await flushSubmissionMicrotasks()
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      expect(harness.runs).toHaveLength(1)
      harness.runs[0]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first', 'second'])
      expect(harness.lifecycle).toEqual(['start:first', 'cleanup:first', 'clear-stream', 'start:second'])
      harness.runs[1]?.finishModel()
      harness.runs[1]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first', 'second', 'third'])
    } finally { await harness.dispose() }
  })
  test('When renderer 伪造内部运行身份 Then 使用主进程生成的运行身份且保留消息原始字段', async () => {
    const harness = createSubmissionHarness()
    try {
      const input = { ...message('first'), runGeneration: 999999, rawUserMessage: '原始 @file', mentionedSkills: ['检查'], additionalDirectories: ['/授权目录'] }
      const submission = observeSend(harness.send(input))
      await flushSubmissionMicrotasks()
      expect(submission.result).toEqual({ disposition: 'sent' })
      expect(harness.runs[0]?.input.runGeneration).toBe(1)
      expect(harness.runs[0]?.input).toMatchObject({ rawUserMessage: '原始 @file', mentionedSkills: ['检查'], additionalDirectories: ['/授权目录'] })
    } finally { await harness.dispose() }
  })
  test('When desktop 已预定 dispatch 且尚未进入 startRun 微任务 Then headless 不能抢占该会话', async () => {
    const harness = createSubmissionHarness()
    const errors: string[] = []
    let completed = 0
    try {
      harness.onDispatchReserved(() => {
        void harness.startHeadless(message('automation'), {
          onError: (error) => { errors.push(error) },
          onComplete: () => { completed++ },
          onTitleUpdated: () => undefined,
          source: 'bridge',
        })
      })
      const desktop = observeSend(harness.send(message('desktop')))
      await flushSubmissionMicrotasks()
      expect(desktop.result).toEqual({ disposition: 'sent' })
      expect(errors).toEqual(['会话正在启动或运行中，请等待当前请求结束后再发送。'])
      expect(completed).toBe(1)
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['desktop'])
    } finally { await harness.dispose() }
  })
  test('When 用户在镜像预检阶段停止 Then 记住停止意图而非等待 runtime 创建后才能取消', async () => {
    const harness = createSubmissionHarness({ holdMirror: true })
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      harness.stop()
      expect(harness.runs).toHaveLength(0)
      expect(harness.stops).toEqual([true])
    } finally { await harness.dispose() }
  })
  test('When 用户在运行或已完成后的 cleanup 阶段停止 Then 不污染下一轮 stop-before-run 标记', async () => {
    const harness = createSubmissionHarness()
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      harness.stop()
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      harness.stop()
      expect(harness.stops).toEqual([false, false])
      expect(harness.runs).toHaveLength(1)
      expect(harness.lifecycle).toEqual(['start:first'])
    } finally { await harness.dispose() }
  })
  test('When Automation/headless 尚未清理结束时桌面发消息 Then 接收后等外部执行释放才启动', async () => {
    const harness = createSubmissionHarness()
    try {
      void harness.startHeadless({ ...message('automation'), triggeredBy: 'automation' }, {
        onError: () => undefined,
        onComplete: () => undefined,
        onTitleUpdated: () => undefined,
        source: 'bridge',
      })
      await flushSubmissionMicrotasks()
      const desktop = observeSend(harness.send(message('desktop')))
      await flushSubmissionMicrotasks()
      expect(desktop.result).toEqual({ disposition: 'sent' })
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['automation'])
      harness.runs[0]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['automation', 'desktop'])
      expect(harness.lifecycle).toEqual(['start:automation', 'cleanup:automation', 'clear-stream', 'start:desktop'])
    } finally { await harness.dispose() }
  })
  test('When desktop 获取占位后流路由注册失败 Then 仍释放占位，后续消息可以启动', async () => {
    const harness = createSubmissionHarness({ failFirstRouteRegistration: true })
    try {
      await harness.startDesktop(message('broken')).catch(() => undefined)
      expect(harness.isReserved()).toBe(false)
      observeSend(harness.send(message('next')))
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['next'])
    } finally { await harness.dispose() }
  })
  test('When headless 获取占位后目标解析失败 Then 仍释放占位，后续桌面消息可以启动', async () => {
    const harness = createSubmissionHarness({ failFirstHeadlessTarget: true })
    try {
      await harness.startHeadless(message('broken'), { onError: () => undefined, onComplete: () => undefined, onTitleUpdated: () => undefined }).catch(() => undefined)
      expect(harness.isReserved()).toBe(false)
      observeSend(harness.send(message('next')))
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['next'])
    } finally { await harness.dispose() }
  })
  test('When 镜像初始化期间 renderer 重载 Then 恢复启动快照并把终态投递到新窗口，cleanup 不再恢复为运行', async () => {
    const harness = createSubmissionHarness({ holdMirror: true })
    try {
      observeSend(harness.send({ ...message('first'), startedAt: 12345 }))
      await flushSubmissionMicrotasks()
      const snapshot = [{ sessionId: 'session', startedAt: 12345, runGeneration: 1 }]
      expect(harness.runs).toHaveLength(0)
      expect(harness.snapshots()).toEqual(snapshot)
      expect(harness.reload()).toEqual(snapshot)
      harness.releaseMirror()
      await flushSubmissionMicrotasks()
      expect(harness.snapshots()).toEqual(snapshot)
      expect(harness.runs[0]?.input.runGeneration).toBe(1)
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      expect(harness.snapshots()).toEqual([])
      expect(harness.deliveries).toContainEqual({ targetId: 2, payload: expect.objectContaining({ sessionId: 'session', runGeneration: 1 }) })
      expect(harness.deliveries.some(({ targetId }) => targetId === 1)).toBe(false)
    } finally { await harness.dispose() }
  })
  test('When Automation/headless 异步预检期间 renderer 重载 Then 恢复相同代际并在新窗口接收终态', async () => {
    const harness = createSubmissionHarness({ holdPreflight: true })
    try {
      void harness.startHeadless({ ...message('automation'), triggeredBy: 'automation', startedAt: 56789 }, {
        onError: () => undefined,
        onComplete: () => undefined,
        onTitleUpdated: () => undefined,
        source: 'bridge',
      })
      await flushSubmissionMicrotasks()
      const snapshot = [{ sessionId: 'session', startedAt: 56789, runGeneration: 1 }]
      expect(harness.runs).toHaveLength(0)
      expect(harness.snapshots()).toEqual(snapshot)
      expect(harness.reload()).toEqual(snapshot)
      harness.releasePreflight()
      await flushSubmissionMicrotasks()
      expect(harness.snapshots()).toEqual(snapshot)
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      expect(harness.snapshots()).toEqual([])
      expect(harness.deliveries).toContainEqual({ targetId: 2, payload: expect.objectContaining({ sessionId: 'session', runGeneration: 1 }) })
    } finally { await harness.dispose() }
  })
  test('When 停止后立即发送且旧停止终态迟到 Then 新发送意图保持有效，清理完成后按队列顺序接力', async () => {
    const harness = createSubmissionHarness()
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      observeSend(harness.send(message('second')))
      await flushSubmissionMicrotasks()
      harness.stop()
      const third = observeSend(harness.send(message('third')))
      await flushSubmissionMicrotasks()
      expect(third.result).toEqual({ disposition: 'sent' })
      harness.runs[0]?.finishModel(true)
      harness.runs[0]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first', 'second'])
      harness.runs[1]?.finishModel()
      harness.runs[1]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first', 'second', 'third'])
    } finally { await harness.dispose() }
  })
  test('When 旧轮完成后在 cleanup 阶段停止且没有新输入 Then 不自动执行已有排队消息', async () => {
    const harness = createSubmissionHarness()
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      observeSend(harness.send(message('second')))
      await flushSubmissionMicrotasks()
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      harness.stop()
      harness.runs[0]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first'])
      expect(harness.queue().map(({ input }) => input.queueMessageId)).toEqual(['second'])
    } finally { await harness.dispose() }
  })
  test('When cleanup 期停止后新输入恢复队列 Then 旧停止标记在收尾被清除，下一轮停止仍正常暂停', async () => {
    const harness = createSubmissionHarness()
    try {
      observeSend(harness.send(message('first')))
      await flushSubmissionMicrotasks()
      observeSend(harness.send(message('second')))
      await flushSubmissionMicrotasks()
      harness.runs[0]?.finishModel()
      await flushSubmissionMicrotasks()
      harness.stop()
      observeSend(harness.send(message('third')))
      await flushSubmissionMicrotasks()
      harness.runs[0]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first', 'second'])
      // 模拟独立的外部中止终态，不能被上一轮 cleanup 的 stop marker 吞掉。
      harness.runs[1]?.finishModel(true)
      harness.runs[1]?.finishCleanup()
      await flushSubmissionMicrotasks()
      expect(harness.runs.map(({ input }) => input.userMessageUuid)).toEqual(['first', 'second'])
      expect(harness.queue().map(({ input }) => input.queueMessageId)).toEqual(['third'])
    } finally { await harness.dispose() }
  })
})
