import { getComputerPauseReason } from '../computer-pause'
import { ReferenceTurnTracker, captureReferenceSnapshot } from '../conversation-reference/send-snapshot'
import { logComputerUseEvent } from '../computer-logger'
import { classifyComputerValidationFailure } from './pi-computer-validation-log'
/**
 * Pi Agent SDK 适配器
 *
 * Gamma 内部继续使用 SDKMessage 兼容协议，避免渲染层、Jotai 状态、
 * JSONL 持久化和历史会话展示在 SDK 迁移时一起改名。
 */

import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { compactComputerScreenshots, injectComputerObservationContext, withComputerRequestFence, hasComputerObservationContent, stripComputerObservationContent, withComputerSharingFence, installComputerInterruptionHooks, computerPermissionInterruption } from './pi-computer-context'
import type { ComputerPrivateObservation } from '@gamma/shared'
import { spawn } from 'node:child_process'
import type { Dispatcher } from 'undici'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  AgentThinkingLevel,
  AgentProviderAdapter,
  CodexOAuthCredentials,
  GithubCopilotOAuthCredentials,
  XaiOAuthCredentials,
  AgentQueryInput,
  JsonSchemaOutputFormat,
  GammaPermissionMode,
  ProviderType,
  SendQueuedMessageOptions,
  SDKMessage,
  AgentAssistantDelta,
  AgentToolCallDelta,
  SDKUserMessageInput,
  SkillActivation,
} from '@gamma/shared'
import {
  calculatePiAutoCompactionReserveTokens,
  inferReasoningTransport,
  isCodexFastModeSupportedModel,
  resolveReasoningProfile,
  createSkillActivationFromPath,
} from '@gamma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'
import { isPromptTooLongError } from '../agent-error-utils'

import type {
  AgentSession,
  AgentSessionEvent,
  ResourceLoader,
  Skill,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Transport as PiAgentTransport } from '@earendil-works/pi-ai'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import type { Agent, AgentMessage, AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai/compat'
import { Type, type TSchema } from 'typebox'
import {
  appendOutputFormatInstruction,
  createAgentRuntimeGuard,
  type AgentRuntimeGuard,
} from '../agent-runtime-guards'
import {
  createGammaManagedResourceLoaderOptions,
  createGammaProjectInstructionFilesOverride,
  type GammaProjectInstructionFile,
} from './pi-resource-loader-overrides'
import { ProjectInstructionScopeController } from './pi-project-instruction-scope'
import type { ProjectInstructionSource } from '../project-instruction-resolver'
import { createCodexFastModeExtension, withCodexFastModeServiceTier } from './pi-codex-request-settings'
import { createDeepSeekReasoningRequestExtension } from './pi-deepseek-reasoning-request-settings'
import { createOpenAIReasoningRequestExtension } from './pi-openai-reasoning-request-settings'
import { mergeRuntimeEnv, type AgentRuntimeEnv } from '../agent-runtime-env'
import { createMemoryExtension } from '../memory'
import { getMemoryDir } from '../config-paths'
import { createConversationReferenceExtension } from '../conversation-reference/pi-tools'
import { injectConversationReferencesContext } from '../conversation-reference/context-injector'
import { sanitizePiMessageImageContent, sanitizeToolResultImageContent } from '../image-content-validation'
import {
  convertPiMessage,
  convertComputerInterruptionNotice,
  convertResultMessage,
  displayToolName,
  dropTrailingAbortedAssistant,
  hasToolResult,
  isAbortedAssistantMessage,
  isAssistantPiMessage,
  normalizePermissionInput,
  restorePiInput,
} from './pi-message-adapter'
import { DEFAULT_CONTEXT_WINDOW, buildModel } from './pi-model-registry'
import { PendingPromptSkillActivationTracker } from './pi-skill-activation-tracker'
import { GammaTaskProgressController, type GammaTaskItem } from './pi-task-progress'
import { normalizePiToolResultDetails, serializePiToolResultPayload } from './pi-tool-result-json'
import { createPiRetryTerminalGate, mapPiNativeRetryEvent } from './pi-retry-control'
import { PI_MODEL_IDLE_TIMEOUT_MS, PI_MODEL_RETRY_SETTINGS, withPiStreamWatchdog } from './pi-stream-watchdog'
import {
  closePiRequestProxyDispatcher,
  createPiRequestProxyDispatcher,
  installPiRequestProxyFetch,
  runWithPiRequestProxy,
} from './pi-request-proxy'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type BashOperations = import('@earendil-works/pi-coding-agent').BashOperations
type BashToolOptions = import('@earendil-works/pi-coding-agent').BashToolOptions
type PowerShellToolOptions = import('@earendil-works/pi-coding-agent').PowerShellToolOptions
type SkillLoadResult = ReturnType<ResourceLoader['getSkills']>

const MAX_AUTOMATIC_COMPACTION_CONTINUATIONS = 20

export function shouldMarkCompactionAfterCompletedTurn(
  terminalResult: SDKMessage | undefined,
  requiresOriginalTaskContinuation: boolean,
): boolean {
  return terminalResult?.type === 'result'
    && terminalResult.subtype === 'success'
    && !requiresOriginalTaskContinuation
}

/** Pi SDK 查询选项（扩展通用 AgentQueryInput） */
export interface PiAgentQueryOptions extends AgentQueryInput {
  runId?: string
  /** 由可信主进程决定，模型或query payload不能自行授予本地租约。 */
  desktopMode?: boolean
  /** 常规电脑工具的外发核验，不启用独占工具模式。 */
  computerToolsAvailable?: boolean
  getComputerObservations?: (signal?: AbortSignal) => Promise<ComputerPrivateObservation[]>
  validateComputerLease?: (signal?: AbortSignal) => Promise<void>
  apiKey: string
  baseUrl?: string
  provider: ProviderType
  /** OAuth credential coordination key; equals the selected Gamma channel id. */
  channelId?: string
  channelName?: string
  maxTurns?: number
  permissionMode: GammaPermissionMode
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ) => Promise<PermissionResult>
  systemPrompt: string
  /** Gamma 已验证的项目根 instruction files；不触发 Pi 的磁盘自动发现。 */
  projectInstructionFiles?: GammaProjectInstructionFile[]
  /** 用于 typed 文件工具的会话级子目录指令激活；不会解析 Bash。 */
  projectInstructionScope?: {
    projectRoot: string
    initialSources: ProjectInstructionSource[]
  }
  resumeSessionId?: string
  piAgentDir: string
  piSessionDir: string
  customTools?: ToolDefinition[]
  onSessionId?: (sdkSessionId: string, sessionFile?: string) => void
  /** Pi final assistant UI UUID → 持久树状 session entry ID。 */
  onPiEntryBindings?: (bindings: Record<string, string>) => void
  onModelResolved?: (model: string) => void
  onContextWindow?: (contextWindow: number) => void
  onRetry?: (update: import('./pi-retry-control').PiRetryUpdate) => void
  /** 渲染进程创建的本轮流式开始时间，用于隔离迟到的 native retry 事件。 */
  retryRunStartedAt?: number
  thinkingLevel?: AgentThinkingLevel
  maxBudgetUsd?: number
  outputFormat?: JsonSchemaOutputFormat
  /** Gamma 聚合的附加目录；Pi 内置工具 factory 不接收多 root 参数，编排层会把它们注入 systemPrompt。 */
  additionalDirectories?: string[]
  additionalSkillPaths?: string[]
  /** 当前用户输入显式引用的 Skill name（兼容历史 slug 已在编排层归一化） */
  skillMentions?: string[]
  /** Persisted user-message UUID for turn-scoped Skill attribution. */
  initialUserMessageUuid?: string
  /** Workspace that owns `additionalSkillPaths`, used for relocatable Skill previews. */
  skillWorkspaceSlug?: string
  /** Skill 成功加载并注入 prompt 后回调。 */
  onSkillActivated?: (activations: SkillActivation[], userMessageUuid: string) => void
  proxyUrl?: string
  /** Pi 模型请求传输策略：auto / sse / websocket / websocket-cached */
  transport?: PiAgentTransport
  /** HTTP 头/响应体空闲超时，单位毫秒；0 表示交给 Pi SDK 禁用超时 */
  httpIdleTimeoutMs?: number
  /** WebSocket 建连超时，单位毫秒；0 表示交给 Pi SDK 禁用超时 */
  websocketConnectTimeoutMs?: number
  runtimeEnv?: AgentRuntimeEnv
  /** 手动压缩请求：走 pi 原生 session.compact()，而非把 /compact 当普通 prompt 发给模型 */
  compactRequest?: boolean
  /** ChatGPT Codex Fast Mode；仅 openai-codex 的受支持模型实际注入 priority service tier。 */
  codexFastMode?: boolean
  /** Pi 的 OAuth credential store 使用真实 expires 和 refresh，不读取 ~/.pi。 */
  codexOAuthCredentials?: CodexOAuthCredentials
  /** Pi 运行中刷新 OAuth 后，将新凭据回写到 Gamma 渠道存储。 */
  onCodexOAuthCredentialsRefreshed?: (credentials: CodexOAuthCredentials) => void | Promise<void>
  /** GitHub Copilot OAuth credential store 使用真实 expires、模型策略和 refresh，不读取 ~/.pi。 */
  githubCopilotOAuthCredentials?: GithubCopilotOAuthCredentials
  /** Pi 运行中刷新 GitHub Copilot OAuth 后，将新凭据及模型策略回写到 Gamma 渠道存储。 */
  onGithubCopilotOAuthCredentialsRefreshed?: (credentials: GithubCopilotOAuthCredentials) => void | Promise<void>
  /** xAI OAuth credential store 使用真实 expires 和 refresh，不读取 ~/.pi。 */
  xaiOAuthCredentials?: XaiOAuthCredentials
  /** Pi 运行中刷新 xAI OAuth 后，将新凭据回写到 Gamma 渠道存储。 */
  onXaiOAuthCredentialsRefreshed?: (credentials: XaiOAuthCredentials) => void | Promise<void>
  /** 会话级 OpenAI（Codex OAuth / Responses API）思考深度。 */
  openAIThinkingLevel?: AgentThinkingLevel
  /** 长期记忆根目录；未指定时默认指向 Gamma 数据目录下的 memory/（按用户隔离）。 */
  memoryRoot?: string
  /** 长期记忆用户标识，用于在 Gamma 数据目录下按用户隔离存储。 */
  memoryUserId?: string
  /** 是否挂载长期记忆扩展（子 Agent、后台任务、computer use 会话应设为 false）。 */
  memoryEnabled?: boolean
  /** 长期记忆是否只读模式 */
  memoryReadOnly?: boolean
}

interface ActivePiSession {
  referenceTurns?: ReferenceTurnTracker
  session?: AgentSession
  resourceLoader?: ResourceLoader
  ready: Promise<AgentSession>
  resolveReady: (session: AgentSession) => void
  rejectReady: (error: unknown) => void
  abortRequested: boolean
  interrupting: boolean
  pendingInterruptPrompts: PendingInterruptPrompt[]
  interruptAbortPromise?: Promise<void>
  readySettled: boolean
  disposed: boolean
  runtimeGuard?: AgentRuntimeGuard
  skillWorkspaceSlug?: string
  pendingSkillActivations: PendingPromptSkillActivationTracker
  queuedMessageAdmission: PiQueuedMessageAdmissionGate
  queuedMessageReceipts?: PiQueuedMessageReceiptTracker
  onSkillActivated?: (activations: SkillActivation[], userMessageUuid: string) => void
}

function createInactiveQueueError(): Error & { code: string } {
  return Object.assign(new Error('当前会话没有正在运行的 Agent'), { code: 'agent.query.not_active' })
}

/**
 * Pi 的 steer/followUp 在内部还会等待 input hooks，即使原 prompt 已结束也可能成功入队。
 * 关闭接收前等待这些入队完成，才能回收未被原 prompt 消费的消息并安全释放会话。
 */
export class PiQueuedMessageAdmissionGate {
  private open = true
  private readonly pending = new Set<Promise<unknown>>()

  assertOpen(): void {
    if (!this.open) throw createInactiveQueueError()
  }

  async admit(enqueue: () => Promise<unknown>): Promise<void> {
    this.assertOpen()
    const operation = Promise.resolve().then(enqueue)
    this.pending.add(operation)
    try {
      await operation
    } finally {
      this.pending.delete(operation)
    }
  }

  async drainAndClose(): Promise<void> {
    // 每次 await 期间可能又开始入队；必须在同一同步片段内观察空集合并关闭。
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
    this.close()
  }

  close(): void {
    this.open = false
  }

  reopen(): void {
    this.open = true
  }
}

export async function recoverUnconsumedPiQueuedMessages(
  admission: PiQueuedMessageAdmissionGate,
  session: Pick<AgentSession, 'pendingMessageCount' | 'clearQueue'>,
  canContinue: () => boolean,
): Promise<string[]> {
  await admission.drainAndClose()
  if (!canContinue() || session.pendingMessageCount === 0) return []
  const unconsumed = session.clearQueue()
  return [...unconsumed.steering, ...unconsumed.followUp]
}

/** 用 Pi 公开 core 入队边界的对象身份确认消费，避免按文本猜测或重发已消费输入。 */
export class PiQueuedMessageReceiptTracker {
  private readonly storage = new AsyncLocalStorage<{ message?: AgentMessage }>()
  private readonly consumed = new WeakSet<AgentMessage>()
  private readonly restore: () => void
  private readonly unsubscribe: () => void
  private pending = 0
  private disposed = false

  constructor(private readonly agent: Agent, private readonly onConsumedError: (error: unknown) => void) {
    const steer = agent.steer
    const followUp = agent.followUp
    const capture = (message: AgentMessage): void => {
      const receipt = this.storage.getStore()
      if (receipt) receipt.message = message
    }
    const wrappedSteer: Agent['steer'] = (message) => { capture(message); steer.call(agent, message) }
    const wrappedFollowUp: Agent['followUp'] = (message) => { capture(message); followUp.call(agent, message) }
    agent.steer = wrappedSteer
    agent.followUp = wrappedFollowUp
    this.restore = () => {
      if (agent.steer === wrappedSteer) agent.steer = steer
      if (agent.followUp === wrappedFollowUp) agent.followUp = followUp
      this.storage.disable()
    }
    this.unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_end') this.consumed.add(event.message)
    })
  }

  async submit(enqueue: () => Promise<unknown>, isCurrent: () => boolean): Promise<void> {
    const receipt: { message?: AgentMessage } = {}
    const wasConsumed = (): boolean => receipt.message !== undefined
      && (this.consumed.has(receipt.message) || this.agent.state.messages.includes(receipt.message))
    this.pending += 1
    try {
      try {
        await this.storage.run(receipt, enqueue)
      } catch (error) {
        if (wasConsumed()) {
          // 提交已经成功，错误仍交给原 query 上报；不能把这条输入变成可重发消息。
          this.onConsumedError(error)
          return
        }
        if (!isCurrent()) throw createInactiveQueueError()
        throw error
      }
      // 未入队表示 SDK input hook 主动 handled，保留其成功语义。
      if (receipt.message && !wasConsumed() && !isCurrent()) throw createInactiveQueueError()
    } finally {
      this.pending -= 1
      if (this.disposed && this.pending === 0) this.restore()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    // 晚到的 SDK 入队仍需留下回执；只在最后一个在途调用退出后恢复旧 Agent 方法。
    if (this.pending === 0) this.restore()
  }
}

interface PendingInterruptPrompt {
  referenceKey?: string
  content: string
  skillActivationId?: number
  resolveAccepted: () => void
  rejectAccepted: (error: unknown) => void
}

interface AssistantMessageState {
  uuid?: string
}

/**
 * 同一 assistant 流在 Pi native retry 前后必须复用 UUID：renderer 才能用恢复后的
 * partial/final frame 原地替换断流前的 partial，而不是把两段回答并排追加。
 */
export function createPiAssistantUuidTracker(createUuid: () => string = randomUUID): {
  get: () => string
  reset: () => void
} {
  let state: AssistantMessageState = {}

  return {
    get: () => {
      if (!state.uuid) state = { uuid: createUuid() }
      if (!state.uuid) throw new Error('Pi assistant message uuid 初始化失败')
      return state.uuid
    },
    reset: () => { state = {} },
  }
}

function toolCallDeltaFromPartial(event: Extract<AssistantMessageEvent, { type: 'toolcall_start' | 'toolcall_delta' }>): AgentToolCallDelta | undefined {
  const block = event.partial.content[event.contentIndex]
  if (!block || block.type !== 'toolCall') return undefined
  return {
    id: block.id,
    name: displayToolName(block.name, block.arguments as Record<string, unknown>),
    ...(event.type === 'toolcall_delta' ? {} : { arguments: {} }),
  }
}

/** Extract only the small structured delta from Pi's cumulative message_update event. */
export function serializePiAssistantDelta(event: AssistantMessageEvent): AgentAssistantDelta | undefined {
  switch (event.type) {
    case 'start': return { type: 'start' }
    case 'text_start': return { type: 'text_start', contentIndex: event.contentIndex }
    case 'text_delta': return { type: 'text_delta', contentIndex: event.contentIndex, delta: event.delta }
    case 'text_end': return { type: 'text_end', contentIndex: event.contentIndex, content: event.content }
    case 'thinking_start': return { type: 'thinking_start', contentIndex: event.contentIndex }
    case 'thinking_delta': return { type: 'thinking_delta', contentIndex: event.contentIndex, delta: event.delta }
    case 'thinking_end': return { type: 'thinking_end', contentIndex: event.contentIndex, content: event.content }
    case 'toolcall_start': {
      const toolCall = toolCallDeltaFromPartial(event)
      return { type: 'toolcall_start', contentIndex: event.contentIndex, ...(toolCall ? { toolCall } : {}) }
    }
    case 'toolcall_delta': {
      const toolCall = toolCallDeltaFromPartial(event)
      return { type: 'toolcall_delta', contentIndex: event.contentIndex, delta: event.delta, ...(toolCall ? { toolCall } : {}) }
    }
    case 'toolcall_end':
      return {
        type: 'toolcall_end',
        contentIndex: event.contentIndex,
        toolCall: {
          id: event.toolCall.id,
          name: displayToolName(event.toolCall.name, event.toolCall.arguments as Record<string, unknown>),
          arguments: event.toolCall.arguments as Record<string, unknown>,
        },
      }
    default:
      return undefined
  }
}

export interface PiRemoteConnectionSettings {
  httpProxy?: string
  transport?: PiAgentTransport
  httpIdleTimeoutMs?: number
  websocketConnectTimeoutMs?: number
}

interface AsyncQueue<T> {
  push: (value: T) => void
  fail: (error: unknown) => void
  close: () => void
  next: () => Promise<IteratorResult<T>>
}

function getCaseInsensitiveRuntimeEnvValue(env: Record<string, string> | undefined, key: string): string | undefined {
  if (!env) return undefined
  const exact = env[key]
  if (exact) return exact
  const foundKey = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())
  const value = foundKey ? env[foundKey] : undefined
  return value || undefined
}

function normalizeProxyUrl(proxyUrl: string | undefined): string | undefined {
  const trimmed = proxyUrl?.trim()
  return trimmed ? trimmed : undefined
}

function resolvePiHttpProxy(input: Pick<PiAgentQueryOptions, 'proxyUrl' | 'runtimeEnv'>): string | undefined {
  return normalizeProxyUrl(input.proxyUrl)
    ?? normalizeProxyUrl(getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'HTTPS_PROXY'))
    ?? normalizeProxyUrl(getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'HTTP_PROXY'))
    ?? normalizeProxyUrl(getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'ALL_PROXY'))
}

function isNonNegativeFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0
}

export function buildPiRemoteConnectionSettings(
  input: Pick<
    PiAgentQueryOptions,
    'provider' | 'proxyUrl' | 'runtimeEnv' | 'transport' | 'httpIdleTimeoutMs' | 'websocketConnectTimeoutMs'
  >,
): PiRemoteConnectionSettings {
  const httpProxy = resolvePiHttpProxy(input)
  // Node/Electron 的 WebSocket 不支持请求级 HTTP 代理注入；有代理的 Codex
  // 默认改走可由 undici dispatcher 承载的 SSE。用户显式选择 transport 时保留其意图。
  const transport = input.transport ?? (httpProxy && input.provider === 'openai-codex' ? 'sse' : undefined)
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(transport ? { transport } : {}),
    ...(isNonNegativeFiniteNumber(input.httpIdleTimeoutMs) ? { httpIdleTimeoutMs: input.httpIdleTimeoutMs } : {}),
    ...(isNonNegativeFiniteNumber(input.websocketConnectTimeoutMs)
      ? { websocketConnectTimeoutMs: input.websocketConnectTimeoutMs }
      : {}),
  }
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = []
  const waiters: Array<(result: IteratorResult<T>) => void> = []
  let closed = false
  let failure: unknown

  const flush = (): void => {
    while (waiters.length > 0 && (values.length > 0 || closed || failure)) {
      const waiter = waiters.shift()!
      if (values.length > 0) {
        waiter({ value: values.shift()!, done: false })
      } else if (failure) {
        const err = failure
        failure = undefined
        Promise.resolve().then(() => { throw err }).catch(() => {})
        waiter(Promise.reject(err) as unknown as IteratorResult<T>)
      } else {
        waiter({ value: undefined, done: true })
      }
    }
  }

  return {
    push(value) {
      if (closed) return
      values.push(value)
      flush()
    },
    fail(error) {
      if (closed) return
      failure = error
      closed = true
      flush()
    },
    close() {
      closed = true
      flush()
    },
    next() {
      if (values.length > 0) {
        return Promise.resolve({ value: values.shift()!, done: false })
      }
      if (failure) {
        const err = failure
        failure = undefined
        return Promise.reject(err)
      }
      if (closed) {
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
    },
  }
}

const SESSION_READY_TIMEOUT_MS = 60_000
const SKILL_COMMAND_PATTERN = /\/skill:([A-Za-z0-9][A-Za-z0-9._-]*)/g

function createActivePiSession(): ActivePiSession {
  let resolveReady!: (session: AgentSession) => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<AgentSession>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  ready.catch(() => {})
  return {
    ready,
    resolveReady,
    rejectReady,
    abortRequested: false,
    interrupting: false,
    pendingInterruptPrompts: [],
    pendingSkillActivations: new PendingPromptSkillActivationTracker(),
    queuedMessageAdmission: new PiQueuedMessageAdmissionGate(),
    readySettled: false,
    disposed: false,
  }
}

function resolveActiveReady(active: ActivePiSession, session: AgentSession): void {
  if (active.readySettled) return
  active.readySettled = true
  active.resolveReady(session)
}

function rejectActiveReady(active: ActivePiSession, error: unknown): void {
  if (active.readySettled) return
  active.readySettled = true
  active.rejectReady(error)
}

function createAbortError(): Error {
  const error = new Error('Agent 执行已停止')
  error.name = 'AbortError'
  return error
}

/** 仅在有电脑观察内容时调用；取消优先，其他核验失败记录并剥离观察。 */
export async function validateOrStripComputerObservations(
  messages: AgentMessage[],
  options: { sessionId: string; runId?: string; signal?: AbortSignal; validate?: (signal?: AbortSignal) => Promise<void>; createAbortError: () => Error },
): Promise<AgentMessage[]> {
  try {
    if (!options.validate) throw new Error('缺少电脑外发核验')
    await options.validate(options.signal)
    return messages
  } catch (error) {
    if (options.signal?.aborted) throw options.createAbortError()
    const failure = classifyComputerValidationFailure(error)
    logComputerUseEvent({
      time: new Date().toISOString(), sessionId: options.sessionId, runId: options.runId ?? null,
      event: 'validate-failed', outcome: 'stripped', ...failure,
    })
    return stripComputerObservationContent(messages, failure.reason, getComputerPauseReason(error))
  }
}

function rejectPendingInterruptPrompts(active: ActivePiSession, error: unknown): void {
  const pending = active.pendingInterruptPrompts.splice(0)
  for (const prompt of pending) {
    active.pendingSkillActivations.discard(prompt.skillActivationId)
    if (prompt.referenceKey) active.referenceTurns?.discard(prompt.referenceKey)
    prompt.rejectAccepted(error)
  }
}

async function waitForActiveSession(active: ActivePiSession): Promise<AgentSession> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      active.ready,
      new Promise<AgentSession>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Agent 会话初始化超时，请稍后重试')), SESSION_READY_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function findSessionFile(sessionDir: string, sdkSessionId: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined
  for (const entry of readdirSync(sessionDir)) {
    if (entry.endsWith('.jsonl') && entry.includes(sdkSessionId)) {
      return join(sessionDir, entry)
    }
  }
  return undefined
}

function isPathWithinRoot(path: string, root: string): boolean {
  if (path === root) return true
  const rel = relative(root, path)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function buildAllowedSkillRoots(additionalSkillPaths: string[] | undefined): string[] {
  return (additionalSkillPaths ?? [])
    .map((path) => resolveGuardedRealPath(path))
    .filter((path, index, arr) => arr.indexOf(path) === index)
}

function isGammaSkillPath(path: string | undefined, allowedRoots: string[]): boolean {
  if (!path || allowedRoots.length === 0) return false
  const guardedPath = resolveGuardedRealPath(path)
  return allowedRoots.some((root) => isPathWithinRoot(guardedPath, root))
}

function createGammaSkillsOverride(additionalSkillPaths: string[] | undefined): (base: SkillLoadResult) => SkillLoadResult {
  const allowedRoots = buildAllowedSkillRoots(additionalSkillPaths)
  return (base) => ({
    skills: base.skills.filter((skill) =>
      isGammaSkillPath(skill.filePath, allowedRoots) || isGammaSkillPath(skill.baseDir, allowedRoots)),
    diagnostics: base.diagnostics.filter((diagnostic) => isGammaSkillPath(diagnostic.path, allowedRoots)),
  })
}

function stripSkillFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '')
  const frontmatter = normalized.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/)
  return frontmatter ? normalized.slice(frontmatter[0].length) : content
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function skillCommandAliases(skill: Skill): string[] {
  const aliases = [skill.name, basename(skill.baseDir), basename(dirname(skill.filePath))]
  return aliases.filter((alias, index, arr) => Boolean(alias) && arr.indexOf(alias) === index)
}

function extractSkillCommandNames(prompt: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of prompt.matchAll(SKILL_COMMAND_PATTERN)) {
    const name = match[1]?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function buildSkillLookup(skills: Skill[]): Map<string, Skill> {
  const lookup = new Map<string, Skill>()
  for (const skill of skills) {
    for (const alias of skillCommandAliases(skill)) {
      if (!lookup.has(alias)) lookup.set(alias, skill)
    }
  }
  return lookup
}

function formatSkillForPrompt(skill: Skill): string | undefined {
  try {
    const body = stripSkillFrontmatter(readFileSync(skill.filePath, 'utf-8')).trim()
    return `<skill name="${escapeXmlAttribute(skill.name)}" location="${escapeXmlAttribute(skill.filePath)}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  } catch (error) {
    console.warn(`[Pi SDK] Skill 展开失败: ${skill.filePath}`, error)
    return undefined
  }
}

interface PreparedPromptWithSkills {
  content: string
  activations: SkillActivation[]
}

async function preparePromptWithGammaSkills(
  resourceLoader: ResourceLoader,
  prompt: string,
  explicitSkillNames?: string[],
  workspaceSlug?: string,
): Promise<PreparedPromptWithSkills> {
  await resourceLoader.reload()

  const requestedNames = explicitSkillNames?.length ? explicitSkillNames : extractSkillCommandNames(prompt)
  if (requestedNames.length === 0) return { content: prompt, activations: [] }

  const skillLookup = buildSkillLookup(resourceLoader.getSkills().skills)
  const blocks: string[] = []
  const activations: SkillActivation[] = []
  const injectedSkillNames = new Set<string>()

  for (const requestedName of requestedNames) {
    const skill = skillLookup.get(requestedName)
    if (!skill || injectedSkillNames.has(skill.name)) continue
    const block = formatSkillForPrompt(skill)
    if (!block) continue
    injectedSkillNames.add(skill.name)
    const activation = createSkillActivationFromPath(
      skill.filePath,
      'explicit',
      skill.name,
      workspaceSlug,
    )
    if (activation) activations.push(activation)
    blocks.push(block)
  }

  if (blocks.length === 0) return { content: prompt, activations: [] }
  return {
    content: `${blocks.join('\n\n')}\n\n${prompt}`,
    activations,
  }
}

function getPiUserMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const userMessage = message as { role?: unknown; content?: unknown }
  if (userMessage.role !== 'user' || !Array.isArray(userMessage.content)) return undefined
  const text = userMessage.content
    .filter((block): block is { type: 'text'; text: string } => (
      Boolean(block)
      && typeof block === 'object'
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map((block) => block.text)
    .join('')
  return text || undefined
}

function registerPromptSkillActivations(
  active: ActivePiSession,
  prompt: string,
  userMessageUuid: string | undefined,
  activations: SkillActivation[],
): number | undefined {
  if (!userMessageUuid) return undefined
  return active.pendingSkillActivations.register(prompt, userMessageUuid, activations)
}

function realpathIfExists(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}

function findNearestExistingPath(path: string): string | undefined {
  let current = path
  while (true) {
    try {
      lstatSync(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

function resolveGuardedRealPath(path: string): string {
  const resolved = resolve(path)
  const exact = realpathIfExists(resolved)
  if (exact) return exact

  const nearestExisting = findNearestExistingPath(resolved)
  if (!nearestExisting) return resolved

  const nearestReal = realpathIfExists(nearestExisting)
  if (!nearestReal) return resolved

  const tail = relative(nearestExisting, resolved)
  return tail ? resolve(nearestReal, tail) : nearestReal
}

interface ToolWrapOptions {
  canUseTool?: PiAgentQueryOptions['canUseTool']
}

function wrapToolWithPermission<TParams extends TSchema, TDetails, TState>(
  definition: ToolDefinition<TParams, TDetails, TState>,
  options: ToolWrapOptions,
): ToolDefinition<TParams, TDetails, TState> {
  const canUseTool = options.canUseTool
  const executionMode = 'sequential' as const
  if (!canUseTool) return { ...definition, executionMode }
  return {
    ...definition,
    executionMode,
    async execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>> {
      const rawInput = params as Record<string, unknown>
      let updatedParams = rawInput
      if (canUseTool) {
        const permission = await canUseTool(displayToolName(definition.name, rawInput), normalizePermissionInput(definition.name, rawInput), {
          signal: signal ?? new AbortController().signal,
          toolUseID: toolCallId,
          displayName: definition.label,
          description: definition.description,
        })
        if (permission.behavior === 'deny') {
          const interruption = computerPermissionInterruption(definition.name, permission.message)
          if (interruption) return interruption as AgentToolResult<TDetails>
          throw new Error(permission.message)
        }
        updatedParams = restorePiInput(definition.name, rawInput, permission.updatedInput)
      }
      return definition.execute(
        toolCallId,
        updatedParams as typeof params,
        signal,
        onUpdate as AgentToolUpdateCallback<TDetails> | undefined,
        ctx,
      ) as Promise<AgentToolResult<TDetails>>
    },
  }
}

function createJsonToolResult(payload: unknown): AgentToolResult<unknown> {
  const serialized = serializePiToolResultPayload(payload)
  return {
    content: [{ type: 'text', text: serialized.text }],
    details: serialized.details,
  } as AgentToolResult<unknown>
}

function createTextToolResult(text: string, details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    ...(details === undefined ? {} : { details: normalizePiToolResultDetails(details) }),
  } as AgentToolResult<unknown>
}

function createTerminatingJsonToolResult(payload: unknown): AgentToolResult<unknown> {
  return {
    ...createJsonToolResult(payload),
    // Compaction must run only after the active Pi agent loop has settled. Continuing
    // this turn would otherwise race with session.compact(), which aborts that loop.
    terminate: true,
  } as AgentToolResult<unknown>
}

export const PI_COMPACTION_CONTINUATION_PROMPT = `<gamma_compaction_continuation>
当前会话上下文已经安全压缩。请依据压缩摘要、保留的最近上下文和已持久化的交接状态，继续完成原始用户任务。

- 不要重复已经完成或已提交的操作；先核验当前状态。
- 若仍有工作，立即执行下一项具体行动。
- 只有原始需求全部完成时才给出最终答复；若确实受阻，明确说明阻塞原因。
</gamma_compaction_continuation>`

export function planPiCompactionContinuation(options: {
  continuationCount: number
  abortRequested: boolean
  runtimeLimitReached: boolean
}):
  | { shouldContinue: true; prompt: string }
  | { shouldContinue: false; reason: 'aborted' | 'runtime_limit' | 'continuation_limit' } {
  if (options.abortRequested) return { shouldContinue: false, reason: 'aborted' }
  if (options.runtimeLimitReached) return { shouldContinue: false, reason: 'runtime_limit' }
  if (options.continuationCount >= MAX_AUTOMATIC_COMPACTION_CONTINUATIONS) {
    return { shouldContinue: false, reason: 'continuation_limit' }
  }
  return { shouldContinue: true, prompt: PI_COMPACTION_CONTINUATION_PROMPT }
}

export function canRunCurrentSessionCompaction(toolNames: string[]): boolean {
  return toolNames.length === 1 && toolNames[0] === 'CompactContext'
}

/** AskUserQuestion 必须暂停整个工具批次，不能与后续动作混合执行。 */
export function shouldBlockToolForAskUserQuestion(toolNames: string[], toolName: string): boolean {
  return toolName !== 'AskUserQuestion'
    && toolNames.includes('AskUserQuestion')
    && toolNames.length > 1
}

/**
 * Pi emits `agent_end` before it decides whether an error needs overflow
 * compaction. Keep this one error class local until the matching compaction
 * lifecycle reaches a terminal state, otherwise the outer orchestrator can
 * dispose the session before Pi calls `agent.continue()`.
 */
function isPiContextOverflow(message: AssistantMessage, contextWindow: number | undefined): boolean {
  if (message.stopReason === 'error' && isPromptTooLongError(message.errorMessage)) return true

  if (contextWindow && message.stopReason === 'length' && message.usage?.output === 0) {
    const inputTokens = (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0)
    return inputTokens >= contextWindow * 0.99
  }

  return false
}

export function shouldDeferPiOverflowTerminalMessage(
  message: AssistantMessage,
  contextWindow: number | undefined,
): boolean {
  return message.stopReason !== 'stop' && isPiContextOverflow(message, contextWindow)
}

export function shouldDeferPiOverflowTerminalError(
  message: AssistantMessage | undefined,
  contextWindow: number | undefined,
  willRetry: boolean,
  abortRequested: boolean,
): boolean {
  return !willRetry && !abortRequested && !!message && shouldDeferPiOverflowTerminalMessage(message, contextWindow)
}

function installCurrentSessionCompactionHooks(session: AgentSession): void {
  const previousBeforeToolCall = session.agent.beforeToolCall
  session.agent.beforeToolCall = async (context, signal) => {
    const previousResult = await previousBeforeToolCall?.(context, signal)
    if (previousResult?.block) return previousResult

    const toolNames = context.assistantMessage.content
      .filter((block) => block.type === 'toolCall')
      .map((block) => block.name)
    if (shouldBlockToolForAskUserQuestion(toolNames, context.toolCall.name)) {
      return {
        block: true,
        reason: 'AskUserQuestion 会暂停 Agent，不能与其他工具在同一批次执行。请在收到用户回答后再调用后续工具。',
      }
    }

    if (context.toolCall.name !== 'CompactContext') return previousResult
    if (canRunCurrentSessionCompaction(toolNames)) return previousResult

    // Pi only honors terminate when every tool in a batch is terminating. Rejecting
    // a mixed batch prevents more tool work or another model turn before compaction.
    return {
      block: true,
      reason: 'CompactContext 必须单独调用。请先完成当前工具批次，在下一回合仅调用 CompactContext。',
    }
  }
}

/**
 * Creates a session-scoped compaction control. The callback is closed over by one
 * query invocation, so a model cannot select or compact any other user session.
 */
export function buildCurrentSessionCompactionTool(
  sdk: PiSdk,
  requestCompaction: () => void,
  canUseTool: PiAgentQueryOptions['canUseTool'],
): ToolDefinition {
  const definition = sdk.defineTool({
    name: 'CompactContext',
    label: '压缩当前会话上下文',
    description: 'Compact only the current Pi Agent session after this turn finishes. Before calling, persist a durable handoff or checkpoint to the session workbench or project files as appropriate. Gamma will compact the current session, then automatically continue the original task from the compacted context.',
    promptSnippet: 'CompactContext: after persisting a durable handoff/checkpoint, compact the current session context. Gamma will automatically continue the original task after compaction.',
    parameters: Type.Object({}),
    async execute() {
      requestCompaction()
      return createTerminatingJsonToolResult({
        status: 'scheduled',
        message: '将在当前 Agent 回合安全结束后压缩当前会话上下文，并自动从已持久化的交接状态继续原始任务。',
      })
    },
  })

  return wrapToolWithPermission(
    definition as unknown as ToolDefinition<TSchema, unknown, unknown>,
    { canUseTool },
  ) as ToolDefinition
}

function isCompactionNoopError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /nothing to compact|already compacted/i.test(message)
}

function createCompactionNoopMessage(sessionId: string, error: unknown): SDKMessage {
  const message = error instanceof Error ? error.message : String(error)
  return {
    type: 'system',
    subtype: 'status',
    session_id: sessionId,
    compact_result: 'noop',
    message: /already compacted/i.test(message)
      ? '当前上下文已经压缩过，无需重复压缩。'
      : '当前上下文较小，暂时无需压缩。',
  } as unknown as SDKMessage
}

export async function compactCurrentSessionAfterTurn(
  session: Pick<AgentSession, 'compact' | 'sessionId'>,
  onNoop: (message: SDKMessage) => void,
): Promise<'compacted' | 'noop'> {
  try {
    await session.compact()
    return 'compacted'
  } catch (error) {
    if (!isCompactionNoopError(error)) throw error
    onNoop(createCompactionNoopMessage(session.sessionId, error))
    return 'noop'
  }
}

function createCompactionContinuationLimitResult(sessionId: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    terminal_reason: 'compaction_continuation_limit',
    errors: [`自动压缩续跑已达上限（${MAX_AUTOMATIC_COMPACTION_CONTINUATIONS} 次），任务未确认完成。请检查当前状态后继续。`],
    session_id: sessionId,
  } as unknown as SDKMessage
}

function stringFromInput(input: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return fallback
}

/**
 * 使用 Pi 的 toolCallId 作为默认任务 ID，让 tool_use 和 TaskCreate 结果从流开始就稳定关联。
 * 显式 ID 仅为旧调用格式保留兼容，不应覆盖正常的 opaque toolCallId。
 */
export function resolveGammaTaskId(input: Record<string, unknown>, toolCallId: string): string {
  return stringFromInput(input, ['id', 'taskId', 'task_id'], toolCallId)
}

function normalizeTaskStatus(value: unknown, fallback: GammaTaskItem['status']): GammaTaskItem['status'] {
  if (
    value === 'pending' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'blocked' ||
    value === 'cancelled' ||
    value === 'error' ||
    value === 'deleted'
  ) {
    return value
  }
  return fallback
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => String(item).trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

export function buildGammaProductToolDefinitions(
  sdk: Pick<PiSdk, 'defineTool'>,
  canUseTool: PiAgentQueryOptions['canUseTool'],
  tasks: Map<string, GammaTaskItem>,
): ToolDefinition[] {

  const definitions = [
    sdk.defineTool({
      name: 'EnterPlanMode',
      label: '进入计划模式',
      description: '进入 Gamma 计划模式。进入后只能调研、整理计划；将完整计划写入会话 plan/ 目录，并等待用户批准后再执行写操作。',
      promptSnippet: '进入计划模式，先调研，将完整计划写入 plan Markdown 文档，再等待用户确认。',
      parameters: Type.Object({
        reason: Type.Optional(Type.String({ description: '进入计划模式的原因。' })),
      }),
      async execute(_toolCallId, params) {
        return createTextToolResult('已进入计划模式。', { active: true, input: params })
      },
    }),
    sdk.defineTool({
      name: 'ExitPlanMode',
      label: '提交计划审批',
      description: '向用户提交计划并请求批准。应传入 planFile 以便用户在右侧只读预览完整 Markdown 计划；用户批准后才能退出计划模式并继续执行。',
      promptSnippet: '提交计划审批：附上已写入 plan/ 目录的 Markdown 计划文件，等待用户批准后继续执行。',
      parameters: Type.Object({
        plan: Type.Optional(Type.String({ description: '计划正文或摘要。' })),
        planFile: Type.String({ description: '当前会话 plan/ 目录内、待审批的 Markdown 计划文件绝对路径（必填）。' }),
        allowedPrompts: Type.Optional(Type.Array(Type.Object({
          tool: Type.String({ description: '批准后可执行的工具，通常为 Bash。' }),
          prompt: Type.String({ description: '批准后可执行的命令或操作描述。' }),
        }))),
      }),
      async execute(_toolCallId, params) {
        return createTextToolResult('计划已获批准，可以继续执行。', { approved: true, input: params })
      },
    }),
    sdk.defineTool({
      name: 'AskUserQuestion',
      label: '询问用户',
      description: '当需要用户选择、补充信息或确认偏好时调用，Gamma 会展示可交互问答横幅。',
      promptSnippet: '向用户提出结构化问题并等待回答。',
      parameters: Type.Object({
        questions: Type.Array(Type.Object({
          question: Type.String({ description: '要询问用户的问题。' }),
          header: Type.Optional(Type.String({ description: '简短标题。' })),
          multiSelect: Type.Optional(Type.Boolean({ description: '是否允许多选。' })),
          options: Type.Optional(Type.Array(Type.Object({
            label: Type.String({ description: '选项标签。' }),
            description: Type.Optional(Type.String({ description: '选项说明。' })),
            preview: Type.Optional(Type.String({ description: '可选预览内容。' })),
          }))),
        })),
        answers: Type.Optional(Type.Record(Type.String(), Type.String())),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        return createJsonToolResult({ answers: input.answers ?? {} })
      },
    }),
    sdk.defineTool({
      name: 'TaskCreate',
      label: '创建任务',
      description: '创建一个可见进度阶段。复杂工作应按可独立验收的阶段分别创建任务，后续用 TaskUpdate 更新对应阶段。',
      promptSnippet: '为复杂工作分别创建多个可验收阶段，不把整个计划塞进一个反复改名的任务。',
      parameters: Type.Object({
        subject: Type.String({ description: '任务标题。' }),
        description: Type.Optional(Type.String({ description: '任务说明。' })),
        activeForm: Type.Optional(Type.String({ description: '当前活动形态或阶段。' })),
        blocks: Type.Optional(Type.Array(Type.String({ description: '关联区块 ID。' }))),
      }),
      async execute(toolCallId, params) {
        const input = params as Record<string, unknown>
        const id = resolveGammaTaskId(input, toolCallId)
        const task: GammaTaskItem = {
          id,
          subject: stringFromInput(input, ['subject', 'title', 'name'], `任务 #${id}`),
          status: 'pending',
          description: typeof input.description === 'string' ? input.description : undefined,
          activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined,
          blocks: normalizeStringArray(input.blocks),
        }
        tasks.set(id, task)
        return createJsonToolResult({ task })
      },
    }),
    sdk.defineTool({
      name: 'TaskUpdate',
      label: '更新任务',
      description: '更新已有可见进度任务的状态、标题或说明。',
      promptSnippet: '更新可见进度任务。',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务 ID。' }),
        status: Type.Optional(Type.Union([
          Type.Literal('pending'),
          Type.Literal('in_progress'),
          Type.Literal('completed'),
          Type.Literal('blocked'),
          Type.Literal('cancelled'),
          Type.Literal('error'),
          Type.Literal('deleted'),
        ])),
        subject: Type.Optional(Type.String({ description: '新的任务标题。' })),
        description: Type.Optional(Type.String({ description: '新的任务说明。' })),
        activeForm: Type.Optional(Type.String({ description: '当前活动形态或阶段。' })),
        blocks: Type.Optional(Type.Array(Type.String({ description: '关联区块 ID。' }))),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        const id = stringFromInput(input, ['taskId', 'task_id', 'id'])
        if (!id) throw new Error('taskId 必填')
        const existing = tasks.get(id)
        const task: GammaTaskItem = {
          id,
          subject: stringFromInput(input, ['subject', 'title', 'name'], existing?.subject ?? `任务 #${id}`),
          status: normalizeTaskStatus(input.status, existing?.status ?? 'pending'),
          description: typeof input.description === 'string' ? input.description : existing?.description,
          activeForm: typeof input.activeForm === 'string' ? input.activeForm : existing?.activeForm,
          blocks: normalizeStringArray(input.blocks) ?? existing?.blocks,
        }
        tasks.set(id, task)
        return createJsonToolResult({ task })
      },
    }),
    sdk.defineTool({
      name: 'TaskGet',
      label: '查看任务',
      description: '读取某个可见进度任务的当前状态。',
      promptSnippet: '查看可见进度任务。',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务 ID。' }),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        const id = stringFromInput(input, ['taskId', 'task_id', 'id'])
        if (!id) throw new Error('taskId 必填')
        const task = tasks.get(id)
        if (!task) throw new Error(`任务不存在: ${id}`)
        return createJsonToolResult({ task })
      },
    }),
    sdk.defineTool({
      name: 'TaskList',
      label: '任务列表',
      description: '列出当前会话分支中已创建的可见进度任务。',
      promptSnippet: '列出可见进度任务。',
      parameters: Type.Object({
        reason: Type.Optional(Type.String({ description: '读取任务列表的原因。' })),
      }),
      async execute() {
        return createJsonToolResult({ tasks: [...tasks.values()].filter((task) => task.status !== 'deleted') })
      },
    }),
    sdk.defineTool({
      name: 'TodoRead',
      label: '读取待办',
      description: '读取当前会话分支的任务列表。兼容旧 TodoRead 调用。',
      promptSnippet: '读取当前待办列表。',
      parameters: Type.Object({}),
      async execute() {
        return createJsonToolResult({ todos: [...tasks.values()].filter((task) => task.status !== 'deleted') })
      },
    }),

  ] as unknown as ToolDefinition[]

  return definitions.map((tool) =>
    wrapToolWithPermission(tool as unknown as ToolDefinition<TSchema, unknown, unknown>, { canUseTool }) as ToolDefinition)
}

const WSL_EXPORT_ENV_KEYS = [
  'GAMMA_CLI',
  'PROMA_CLI',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'GAMMA_WINDOWS_SHELL',
  'GAMMA_WSL_DISTRO',
] as const

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`
}

export function windowsPathToWslPath(value: string): string {
  const driveMatch = value.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!driveMatch) return value
  const drive = driveMatch[1]!.toLowerCase()
  const rest = driveMatch[2]!.replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
}

function buildWslCommand(command: string, env: NodeJS.ProcessEnv | undefined): string {
  const exportLines: string[] = []
  for (const key of WSL_EXPORT_ENV_KEYS) {
    const rawValue = env?.[key]
    if (!rawValue) continue
    const value = key === 'GAMMA_CLI' || key === 'PROMA_CLI' ? windowsPathToWslPath(rawValue) : rawValue
    exportLines.push(`export ${key}=${shellQuote(value)}`)
  }

  return exportLines.length > 0
    ? `${exportLines.join('\n')}\n${command}`
    : command
}

export function buildWslBashArgs(
  runtimeEnv: Pick<AgentRuntimeEnv, 'wslDistro'>,
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv | undefined,
): string[] {
  return [
    ...(runtimeEnv.wslDistro ? ['--distribution', runtimeEnv.wslDistro] : []),
    '--cd',
    windowsPathToWslPath(cwd),
    '--exec',
    'bash',
    '-lc',
    buildWslCommand(command, env),
  ]
}

function createWslBashOperations(runtimeEnv: AgentRuntimeEnv): BashOperations {
  return {
    exec(command, cwd, options) {
      return new Promise((resolve, reject) => {
        const mergedEnv = mergeRuntimeEnv(process.env, options.env)
        const args = buildWslBashArgs(runtimeEnv, cwd, command, mergedEnv)
        const child = spawn(runtimeEnv.wslCommand ?? 'wsl.exe', args, {
          env: mergedEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        let settled = false
        let timedOut = false
        let timeoutHandle: NodeJS.Timeout | undefined

        const cleanup = (): void => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          options.signal?.removeEventListener('abort', onAbort)
        }
        const settle = (fn: () => void): void => {
          if (settled) return
          settled = true
          cleanup()
          fn()
        }
        const killChild = (): void => {
          if (!child.killed) child.kill('SIGTERM')
        }
        const onAbort = (): void => {
          killChild()
        }

        if (options.signal?.aborted) {
          killChild()
          settle(() => reject(new Error('aborted')))
          return
        }

        child.stdout?.on('data', options.onData)
        child.stderr?.on('data', options.onData)
        child.on('error', (error) => {
          settle(() => reject(error))
        })
        child.on('close', (code) => {
          if (options.signal?.aborted) {
            settle(() => reject(new Error('aborted')))
          } else if (timedOut) {
            settle(() => reject(new Error(`timeout:${options.timeout}`)))
          } else {
            settle(() => resolve({ exitCode: code }))
          }
        })

        if (options.timeout !== undefined && options.timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            killChild()
          }, options.timeout * 1000)
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
}

function createGammaBashToolOptions(runtimeEnv: AgentRuntimeEnv | undefined): BashToolOptions | undefined {
  if (!runtimeEnv) return undefined

  const spawnHook: NonNullable<BashToolOptions['spawnHook']> = ({ command, cwd, env }) => ({
    command,
    cwd,
    env: mergeRuntimeEnv(env, runtimeEnv.env),
  })

  if (runtimeEnv.shellKind === 'wsl') {
    return {
      operations: createWslBashOperations(runtimeEnv),
      spawnHook,
    }
  }

  return {
    ...(runtimeEnv.shellPath && { shellPath: runtimeEnv.shellPath }),
    spawnHook,
  }
}

export function isPiBashToolAvailable(
  platform: NodeJS.Platform,
  runtimeEnv: Pick<AgentRuntimeEnv, 'shellKind'> | undefined,
): boolean {
  // Pi 的 Windows Bash 工具只能通过 Gamma 配置的 Git Bash 或 WSL 执行。
  return platform !== 'win32' || runtimeEnv?.shellKind === 'git-bash' || runtimeEnv?.shellKind === 'wsl'
}

/** Pi 0.84.3 起可在 Windows 无 Git Bash / WSL 时使用系统原生 PowerShell。 */
export function isPiPowerShellToolAvailable(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

export type PiBuiltinShellTool = 'bash' | 'powershell' | 'none'

/** 每个会话只暴露一种 Shell，避免模型混用 Bash 与 PowerShell 语法。 */
export function selectPiBuiltinShellTool(
  platform: NodeJS.Platform,
  runtimeEnv: Pick<AgentRuntimeEnv, 'shellKind'> | undefined,
): PiBuiltinShellTool {
  if (isPiBashToolAvailable(platform, runtimeEnv)) return 'bash'
  if (isPiPowerShellToolAvailable(platform)) return 'powershell'
  return 'none'
}

function createGammaPowerShellToolOptions(runtimeEnv: AgentRuntimeEnv | undefined): PowerShellToolOptions | undefined {
  if (!runtimeEnv) return undefined
  return {
    spawnHook: ({ command, cwd, env }) => ({
      command,
      cwd,
      env: mergeRuntimeEnv(env, runtimeEnv.env),
    }),
  }
}

function buildBuiltinToolDefinitions(
  sdk: PiSdk,
  cwd: string,
  canUseTool: PiAgentQueryOptions['canUseTool'],
  runtimeEnv: AgentRuntimeEnv | undefined,
): ToolDefinition[] {
  const shellTool = selectPiBuiltinShellTool(process.platform, runtimeEnv)
  const definitions = [
    sdk.createReadToolDefinition(cwd),
    ...(shellTool === 'bash'
      ? [sdk.createBashToolDefinition(cwd, createGammaBashToolOptions(runtimeEnv))]
      : []),
    ...(shellTool === 'powershell'
      ? [sdk.createPowerShellToolDefinition(cwd, createGammaPowerShellToolOptions(runtimeEnv))]
      : []),
    sdk.createEditToolDefinition(cwd),
    sdk.createWriteToolDefinition(cwd),
    sdk.createGrepToolDefinition(cwd),
    sdk.createFindToolDefinition(cwd),
    sdk.createLsToolDefinition(cwd),
  ] as unknown as ToolDefinition[]

  return definitions.map((tool) =>
    wrapToolWithPermission(tool as unknown as ToolDefinition<TSchema, unknown, unknown>, { canUseTool }) as ToolDefinition)
}

function appendWindowsBaseModeInstruction(systemPrompt: string, runtimeEnv: AgentRuntimeEnv | undefined): string {
  const shellTool = selectPiBuiltinShellTool(process.platform, runtimeEnv)
  if (process.platform !== 'win32' || shellTool === 'bash') {
    return systemPrompt
  }

  if (shellTool === 'powershell') {
    return `${systemPrompt}

<runtime_capabilities>
当前 Windows 设备未配置 Git Bash 或 WSL，因此 Bash 工具不可用；已启用原生 PowerShell 工具。需要运行命令、测试或 Git 操作时，请使用 PowerShell，并采用 PowerShell 语法；不要调用 InstallWindowsShell。
</runtime_capabilities>`
  }

  return `${systemPrompt}

<runtime_capabilities>
当前 Windows 设备未配置 Git Bash 或 WSL，因此 Bash 工具不可用。你仍可使用 Read、Write、Edit、Grep、Find、Ls 及 Gamma 提供的其他工具完成任务；不要声称已运行命令、测试或 Git 操作。若任务确实需要命令行，请默认调用 InstallWindowsShell 帮助用户安装 Git Bash；该工具会要求用户确认下载并打开官方安装程序。
</runtime_capabilities>`
}

function wrapCustomToolDefinitions(
  tools: ToolDefinition[] | undefined,
  canUseTool: PiAgentQueryOptions['canUseTool'],
): ToolDefinition[] {
  return (tools ?? []).map((tool) =>
    wrapToolWithPermission(tool as unknown as ToolDefinition<TSchema, unknown, unknown>, { canUseTool }) as ToolDefinition)
}

export function installRuntimeGuardHooks(session: AgentSession, guard: AgentRuntimeGuard): void {
  const previousAfterToolCall = session.agent.afterToolCall
  session.agent.afterToolCall = async (context, signal) => {
    const previousResult = await previousAfterToolCall?.(context, signal)
    const resultAfterPreviousHooks = {
      content: previousResult?.content ?? context.result.content,
      details: previousResult?.details ?? context.result.details,
      terminate: previousResult?.terminate ?? context.result.terminate,
    }
    const sanitizedContent = sanitizeToolResultImageContent(resultAfterPreviousHooks.content)
    const guardedResult = guard.applyToolResult({
      ...resultAfterPreviousHooks,
      content: sanitizedContent,
    })

    if (
      !previousResult
      && guardedResult.terminate === context.result.terminate
      && sanitizedContent === context.result.content
    ) {
      return undefined
    }

    return {
      ...previousResult,
      content: sanitizedContent,
      details: normalizePiToolResultDetails(resultAfterPreviousHooks.details),
      terminate: guardedResult.terminate,
    }
  }

  const previousPrepareNextTurnWithContext = session.agent.prepareNextTurnWithContext
  session.agent.prepareNextTurnWithContext = async (context, signal) => {
    const previousSnapshot = await previousPrepareNextTurnWithContext?.(context, signal)
    if (guard.shouldStopBeforeNextTurn()) {
      // Pi 的 steer/follow-up 队列在 turn 完成后才 drain；达到 Gamma 上限时必须在这里清空，
      // 否则纯文本 turn 之后追加的队列消息会绕过 afterToolCall 继续进入下一轮。
      session.agent.clearAllQueues()
    }
    return previousSnapshot
  }
}

export class PiAgentAdapter implements AgentProviderAdapter {
  private activeSessions = new Map<string, ActivePiSession>()

  async *query(input: PiAgentQueryOptions): AsyncIterable<SDKMessage> {
    const active = createActivePiSession()
    active.referenceTurns = new ReferenceTurnTracker(input.contextRefs ?? captureReferenceSnapshot(input.sessionId))
    if (input.compactRequest) active.queuedMessageAdmission.close()
    this.activeSessions.set(input.sessionId, active)
    const queue = createAsyncQueue<SDKMessage>()
    const runtimeGuard = createAgentRuntimeGuard(input)
    // 同一 session 的新请求可能在旧 IPC 事件之后开始；所有 retry 生命周期均携带这一轮标识。
    const retryRunStartedAt = input.retryRunStartedAt ?? Date.now()
    active.runtimeGuard = runtimeGuard
    active.skillWorkspaceSlug = input.skillWorkspaceSlug
    active.onSkillActivated = input.onSkillActivated
    let unsubscribe: (() => void) | undefined
    let requestProxyDispatcher: Dispatcher | undefined

    const cleanupActiveSession = (): void => {
      try {
        active.queuedMessageAdmission.close()
        active.queuedMessageReceipts?.dispose()
        rejectActiveReady(active, createInactiveQueueError())
        unsubscribe?.()
        unsubscribe = undefined
        if (!active.disposed) {
          active.disposed = true
          rejectPendingInterruptPrompts(active, createAbortError())
          active.pendingSkillActivations.clear()
          active.session?.dispose()
        }
        if (this.activeSessions.get(input.sessionId) === active) {
          this.activeSessions.delete(input.sessionId)
        }
      } finally {
        void closePiRequestProxyDispatcher(requestProxyDispatcher)
        requestProxyDispatcher = undefined
      }
    }

    try {
      installPiRequestProxyFetch()
      requestProxyDispatcher = createPiRequestProxyDispatcher({
        proxyUrl: resolvePiHttpProxy(input),
        noProxy: getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'NO_PROXY'),
        httpIdleTimeoutMs: input.httpIdleTimeoutMs ?? PI_MODEL_IDLE_TIMEOUT_MS,
      })
      const sdk = await import('@earendil-works/pi-coding-agent')
      const piAi = input.codexFastMode && input.provider === 'openai-codex'
        ? await import('@earendil-works/pi-ai/compat')
        : undefined
      if (active.abortRequested) throw createAbortError()

      if (!existsSync(input.piSessionDir)) mkdirSync(input.piSessionDir, { recursive: true })
      const cwd = input.cwd ?? process.cwd()
      const sessionFile = input.resumeSessionId ? findSessionFile(input.piSessionDir, input.resumeSessionId) : undefined
      if (input.resumeSessionId && !sessionFile) {
        throw new Error(`No conversation found with session ID ${input.resumeSessionId}`)
      }
      const sessionManager = sessionFile
        ? sdk.SessionManager.open(sessionFile, input.piSessionDir, cwd)
        : sdk.SessionManager.create(cwd, input.piSessionDir)
      // 分支外的任务及失败调用不能成为当前进度；压缩不删除分支中的原始工具结果。
      const taskProgress = new GammaTaskProgressController(sessionManager.getBranch()
        .filter((entry) => entry.type === 'message')
        .map((entry) => entry.message))
      const { modelRuntime, model } = await buildModel(sdk, input)
      const autoCompactionReserveTokens = calculatePiAutoCompactionReserveTokens(
        model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      )
      let compactContextRequested = false
      let pendingCompactionContinuation: string | undefined
      let automaticCompactionContinuations = 0
      let pendingTerminalResult: SDKMessage | undefined
      /** 当前压缩是否紧随一个成功完成的主 Agent turn。 */
      let completedAgentTurnPendingCompaction = false
      const customTools = [
        buildCurrentSessionCompactionTool(
          sdk,
          () => { compactContextRequested = true },
          input.canUseTool,
        ),
        ...buildBuiltinToolDefinitions(
          sdk,
          cwd,
          input.canUseTool,
          input.runtimeEnv,
        ),
        ...buildGammaProductToolDefinitions(sdk, input.canUseTool, taskProgress.tasks),
        ...wrapCustomToolDefinitions(input.customTools, input.canUseTool),
      ].filter(tool => !input.desktopMode || ['ComputerStatus', 'ComputerObserve', 'ComputerAct', 'ComputerStop', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'].includes(tool.name))

      const settingsManager = sdk.SettingsManager.inMemory({
        // 使用 Pi SDK 原生压缩策略：
        // - 手动压缩由 session.compact() 触发；
        // - 自动压缩在上下文达到模型窗口的约 80% 时触发；Pi 以 reserveTokens 表示预留空间。
        compaction: { enabled: true, reserveTokens: autoCompactionReserveTokens },
        // Pi 原生 retry 通过 agent.continue() 在同一 transcript 中恢复，能保留已完成的
        // tool_result；不能用外层重投原始 prompt 替代，否则会重复执行副作用工具。
        retry: PI_MODEL_RETRY_SETTINGS,
        // Cache warming 会额外发送 provider 请求；在提供显式开关前不应静默增加消耗。
        cacheWarming: 'off',
        ...buildPiRemoteConnectionSettings(input),
        httpIdleTimeoutMs: input.httpIdleTimeoutMs ?? PI_MODEL_IDLE_TIMEOUT_MS,
      })
      const openAIReasoningProfile = (input.provider === 'openai-codex' || input.provider === 'xai' || input.provider === 'openai-responses')
        ? resolveReasoningProfile({
          modelId: input.model,
          transport: inferReasoningTransport(input.provider),
        })
        : undefined
      const deepSeekReasoningProfile = input.provider === 'deepseek'
        ? resolveReasoningProfile({
          modelId: input.model,
          transport: 'anthropic-messages',
        })
        : undefined
      const projectInstructionScope = input.projectInstructionScope
        ? new ProjectInstructionScopeController({
            projectRoot: input.projectInstructionScope.projectRoot,
            cwd,
            initialSources: input.projectInstructionScope.initialSources,
          })
        : undefined
      const shouldMountMemory = input.memoryEnabled === true
      const memoryExtension = shouldMountMemory
        ? createMemoryExtension({
            root: input.memoryRoot ?? getMemoryDir(input.memoryUserId),
            userId: input.memoryUserId,
            readOnly: input.memoryReadOnly,
          })
        : undefined
      const extensionFactories = [
        ...(memoryExtension ? [memoryExtension] : []),
        taskProgress.createExtension(),
        createConversationReferenceExtension(input.sessionId, active.referenceTurns.get),
        ...(projectInstructionScope ? [projectInstructionScope.createExtension()] : []),
        ...(openAIReasoningProfile
          ? [createOpenAIReasoningRequestExtension({
              profile: openAIReasoningProfile,
              thinkingLevel: input.openAIThinkingLevel,
            })]
          : []),
        ...(deepSeekReasoningProfile?.encodings['anthropic-messages']?.kind === 'deepseek-output-effort'
          ? [createDeepSeekReasoningRequestExtension({
              profile: deepSeekReasoningProfile,
              thinkingLevel: input.thinkingLevel,
            })]
          : []),
        ...(input.provider === 'openai-codex' && input.codexFastMode
          ? [createCodexFastModeExtension({ fastMode: true })]
          : []),
      ]
      const resourceLoader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir: input.piAgentDir,
        settingsManager,
        ...createGammaManagedResourceLoaderOptions(),
        agentsFilesOverride: createGammaProjectInstructionFilesOverride(input.projectInstructionFiles ?? []),
        additionalSkillPaths: input.additionalSkillPaths ?? [],
        skillsOverride: createGammaSkillsOverride(input.additionalSkillPaths),
        ...(extensionFactories.length > 0 && { extensionFactories }),
        systemPromptOverride: () => appendWindowsBaseModeInstruction(input.systemPrompt, input.runtimeEnv),
      })
      await resourceLoader.reload()
      active.resourceLoader = resourceLoader

      const skillDiagnostics = resourceLoader.getSkills().diagnostics
      for (const diagnostic of skillDiagnostics) {
        const level = diagnostic.type === 'error' ? 'error' : 'warn'
        console[level](`[Pi SDK] Skill 加载诊断: ${diagnostic.path ?? '(unknown)'} ${diagnostic.message}`)
      }

      const { session } = await sdk.createAgentSession({
        cwd,
        agentDir: input.piAgentDir,
        modelRuntime,
        settingsManager,
        resourceLoader,
        sessionManager,
        model,
        thinkingLevel: input.thinkingLevel ?? 'off',
        noTools: 'builtin',
        customTools,
      })
      await session.bindExtensions({})
      session.agent.toolExecution = 'sequential'
      // Pi session artifact 可以来自旧版本，不能假设其历史 tool_result 已通过当前校验。
      // transformContext 在每个 provider 请求前执行，能隔离 resume 的坏图片而不篡改原 artifact。
      const previousTransformContext = session.agent.transformContext
      session.agent.transformContext = async (messages, signal) => {
        let transformed = await previousTransformContext?.(messages, signal) ?? messages
        transformed = await injectConversationReferencesContext({
          sessionId: input.sessionId,
          contextRefs: active.referenceTurns?.get() ?? [],
          channelId: input.channelId,
          modelId: input.model,
          contextWindow: model.contextWindow,
          messages: transformed,
          signal,
        })
        const sanitized = sanitizePiMessageImageContent(transformed)
        let compacted = compactComputerScreenshots(sanitized, 2)
        if (input.computerToolsAvailable && hasComputerObservationContent(compacted)) {
          compacted = await validateOrStripComputerObservations(compacted, {
            sessionId: input.sessionId, runId: input.runId, signal,
            validate: input.validateComputerLease, createAbortError,
          })
        }
        if (!input.desktopMode || !input.getComputerObservations) return compacted
        const observations = await input.getComputerObservations(signal)
        return injectComputerObservationContext(compacted, observations, signal)
      }
      // Pi 0.86 的 transcript-aware before_agent_start extension 会在下一轮注入动态项目指令。
      if (piAi && input.codexFastMode && input.provider === 'openai-codex' && isCodexFastModeSupportedModel(input.model)) {
        // Pi 的通用 streamSimple 会丢弃 provider 专属 serviceTier；这里直接走
        // provider stream，确保 request body 与 usage.cost 都使用 priority tier。
        session.agent.streamFunction = async (requestModel, context, options) => {
          const authResult = await modelRuntime.getAuth(requestModel)
          if (!authResult?.auth.apiKey) throw new Error('无法获取 ChatGPT (Codex) OAuth access token')
          const auth = authResult.auth

          const env = authResult.env || options?.env ? { ...(authResult.env ?? {}), ...(options?.env ?? {}) } : undefined
          const retrySettings = settingsManager.getProviderRetrySettings()
          const configuredTimeoutMs = settingsManager.getHttpIdleTimeoutMs()
          const timeoutMs = options?.timeoutMs ?? retrySettings.timeoutMs ?? (configuredTimeoutMs === 0 ? 2_147_483_647 : configuredTimeoutMs)
          const websocketConnectTimeoutMs = options?.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs()

          return piAi.stream(requestModel, context, withCodexFastModeServiceTier({
            ...options,
            apiKey: auth.apiKey,
            env,
            timeoutMs,
            websocketConnectTimeoutMs,
            maxRetries: options?.maxRetries ?? retrySettings.maxRetries,
            maxRetryDelayMs: options?.maxRetryDelayMs ?? retrySettings.maxRetryDelayMs,
            headers: { ...auth.headers, ...options?.headers },
          }))
        }
      }
      // 代理作用域必须只覆盖模型 provider stream：在整个 session.prompt() 链上设
      // AsyncLocalStorage 会把 MCP/产品工具等同一 Agent loop 中的 fetch 也错误地送进 Codex 代理。
      const providerStreamFn = input.desktopMode
        ? withComputerRequestFence(session.agent.streamFunction, async (signal) => {
          if (active.abortRequested || signal?.aborted || !input.validateComputerLease) throw createAbortError()
          await input.validateComputerLease(signal)
          if (active.abortRequested || signal?.aborted) throw createAbortError()
        })
        : input.computerToolsAvailable
          ? withComputerSharingFence(session.agent.streamFunction, async signal => {
            if (active.abortRequested || signal?.aborted || !input.validateComputerLease) throw createAbortError()
            await input.validateComputerLease(signal)
          })
          : session.agent.streamFunction
      session.agent.streamFunction = withPiStreamWatchdog(
        (requestModel, context, options) => runWithPiRequestProxy(
          requestProxyDispatcher,
          () => providerStreamFn(requestModel, context, options),
        ),
        input.httpIdleTimeoutMs ?? PI_MODEL_IDLE_TIMEOUT_MS,
      )
      installRuntimeGuardHooks(session, runtimeGuard)
      installCurrentSessionCompactionHooks(session)
      installComputerInterruptionHooks(session.agent)
      active.session = session
      active.queuedMessageReceipts = new PiQueuedMessageReceiptTracker(session.agent, (error) => queue.fail(error))
      resolveActiveReady(active, session)

      if (active.abortRequested) {
        await session.abort().catch(() => {})
        throw createAbortError()
      }

      input.onSessionId?.(session.sessionId, session.sessionFile)
      input.onModelResolved?.(session.model?.id ?? input.model ?? 'default')
      input.onContextWindow?.(model.contextWindow ?? DEFAULT_CONTEXT_WINDOW)

      queue.push({
        type: 'system',
        subtype: 'init',
        session_id: session.sessionId,
        model: session.model?.id ?? input.model,
      } as unknown as SDKMessage)

      const assistantUuidTracker = createPiAssistantUuidTracker()
      // Pi 会在 native retry 前先发出 error assistant，再以 agent_end.willRetry 标记。
      // 延迟向 orchestrator 透传该 error，避免它先触发外层重试而重放整个 prompt。
      const retryTerminalGate = createPiRetryTerminalGate<{
        assistantMessage: AssistantMessage
        sdkMessage: SDKMessage
        assistantUuid: string
      }>()
      let pendingNativeOverflowRecovery = false
      // message_end 发生在 Pi 落盘前；保留对象身份，待 prompt 完成后从
      // SessionManager entries 精确取得 Pi entry ID，绝不按文本猜测。
      const finalAssistantUuids = new Map<AssistantMessage, string>()

      const persistPiEntryBindings = (): void => {
        const bindings: Record<string, string> = {}
        for (const entry of sessionManager.getEntries()) {
          if (entry.type !== 'message' || entry.message.role !== 'assistant') continue
          const uuid = finalAssistantUuids.get(entry.message as AssistantMessage)
          if (uuid) bindings[uuid] = entry.id
        }
        if (Object.keys(bindings).length > 0) input.onPiEntryBindings?.(bindings)
      }

      const assistantUuidFor = (): string => assistantUuidTracker.get()
      const resetAssistantStream = (): void => {
        assistantUuidTracker.reset()
      }

      const emitTerminalRetryError = (terminalRetryError: {
        assistantMessage: AssistantMessage
        sdkMessage: SDKMessage
        assistantUuid: string
      }): void => {
        finalAssistantUuids.set(terminalRetryError.assistantMessage, terminalRetryError.assistantUuid)
        runtimeGuard.recordMessage(terminalRetryError.assistantMessage)
        queue.push(terminalRetryError.sdkMessage)
        resetAssistantStream()
      }

      unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        try {
          switch (event.type) {
            case 'message_start': {
              const prompt = getPiUserMessageText(event.message)
              if (!prompt) break
              active.referenceTurns?.consume(prompt)
              const pending = active.pendingSkillActivations.consume(prompt)
              if (pending) active.onSkillActivated?.(pending.activations, pending.userMessageUuid)
              break
            }
            case 'message_update': {
              if (!isAssistantPiMessage(event.message)) break
              const assistantUuid = assistantUuidFor()
              const delta = serializePiAssistantDelta(event.assistantMessageEvent)
              if (delta) {
                queue.push({
                  type: 'assistant_delta',
                  uuid: assistantUuid,
                  delta,
                  session_id: session.sessionId,
                  ...(input.model && { _channelModelId: input.model }),
                } as unknown as SDKMessage)
              }
              break
            }
            case 'message_end': {
              if (active.interrupting && isAbortedAssistantMessage(event.message)) {
                const converted = convertPiMessage(event.message, session.sessionId, input.model, {
                  uuid: assistantUuidFor(),
                })
                if (converted?.type === 'assistant') queue.push(converted)
                resetAssistantStream()
                break
              }
              const isAssistant = isAssistantPiMessage(event.message)
              const assistantUuid = isAssistant ? assistantUuidFor() : undefined
              const converted = convertPiMessage(event.message, session.sessionId, input.model, {
                ...(assistantUuid && { uuid: assistantUuid }),
              })
              const shouldDeferNativeOverflow = isAssistant
                && shouldDeferPiOverflowTerminalMessage(event.message as AssistantMessage, model.contextWindow)
              const shouldDeferAssistantTerminal = isAssistant && (
                (event.message as AssistantMessage).stopReason === 'error' || shouldDeferNativeOverflow
              )
              if (shouldDeferAssistantTerminal && converted?.type === 'assistant' && assistantUuid) {
                // Native retry 会丢弃该失败 assistant；不应消耗 Gamma 的 turn/budget 配额。
                // 关键：此处不能重置 UUID。retry 后的新 partial/final 必须原地替换此前
                // 已经展示的 partial，避免用户同时看到断流残片和恢复后的完整回答。
                retryTerminalGate.defer({
                  assistantMessage: event.message as AssistantMessage,
                  sdkMessage: converted,
                  assistantUuid,
                })
              } else {
                runtimeGuard.recordMessage(event.message)
                if (converted && (converted.type !== 'user' || hasToolResult(converted))) queue.push(converted)
                if (isAssistant && assistantUuid) {
                  finalAssistantUuids.set(event.message as AssistantMessage, assistantUuid)
                  resetAssistantStream()
                }
              }
              break
            }
            case 'agent_end':
              completedAgentTurnPendingCompaction = false
              if (active.abortRequested || (active.interrupting && active.pendingInterruptPrompts.length > 0)) {
                // 用户停止或插入新 prompt 时，当前 loop 的错误与 result 都不得泄漏到下一轮。
                retryTerminalGate.settle(true)
                pendingNativeOverflowRecovery = false
                pendingTerminalResult = undefined
                resetAssistantStream()
                break
              }
              const deferredRetryError = retryTerminalGate.peek()
              const waitsForNativeOverflowRecovery = shouldDeferPiOverflowTerminalError(
                deferredRetryError?.assistantMessage,
                model.contextWindow,
                event.willRetry,
                active.abortRequested,
              )
              // Pi 在 agent_end 后才会检测 overflow 并压缩。此时若先将错误交给
              // orchestrator，会触发外层恢复或清理，打断同 transcript 的 continue。
              const terminalRetryError = waitsForNativeOverflowRecovery
                ? undefined
                : retryTerminalGate.settle(event.willRetry)
              if (waitsForNativeOverflowRecovery) pendingNativeOverflowRecovery = true
              if (event.willRetry) {
                // native retry 会在同一 session 中调用 continue()，不要向上游发送终态，
                // 并保留当前 UUID，供恢复后的输出替换此前 partial。
                break
              }
              if (terminalRetryError) {
                emitTerminalRetryError(terminalRetryError)
              }
              // Pi can start auto-compaction after agent_end but before session.prompt()
              // resolves. Defer the terminal result until then, otherwise the orchestrator's
              // result-drain timeout may dispose the session and abort compaction.
              const terminalResult = convertResultMessage(
                event.messages,
                session.sessionId,
                runtimeGuard.getResultOverride(event.messages),
              )
              const computerNotice = convertComputerInterruptionNotice(event.messages, session.sessionId)
              if (computerNotice) queue.push(computerNotice)
              pendingTerminalResult = terminalResult
              completedAgentTurnPendingCompaction = shouldMarkCompactionAfterCompletedTurn(
                terminalResult,
                compactContextRequested,
              )
              break
            case 'auto_retry_start':
            case 'auto_retry_end':
              for (const retry of mapPiNativeRetryEvent(event, { runStartedAt: retryRunStartedAt })) input.onRetry?.(retry)
              break
            case 'tool_execution_update':
              queue.push({
                type: 'tool_progress',
                session_id: session.sessionId,
                tool_use_id: event.toolCallId,
                tool_name: displayToolName(event.toolName, event.args as Record<string, unknown> | undefined),
                parent_tool_use_id: null,
              } as unknown as SDKMessage)
              break
            case 'compaction_start': {
              const afterCompletedTurn = completedAgentTurnPendingCompaction
              completedAgentTurnPendingCompaction = false
              // 压缩开始（手动 /compact 或自动阈值/溢出触发）：发前端已识别的 compacting system 消息，
              // 展示「正在压缩上下文...」分隔符。此前迁移遗漏了该事件，导致自动压缩与手动压缩都无 UI。
              // 只有成功完成主 turn 后才进入可验收完成态；运行中压缩仍保持 running。
              queue.push({
                type: 'system',
                subtype: 'compacting',
                session_id: session.sessionId,
                afterCompletedTurn,
              } as unknown as SDKMessage)
              break
            }
            case 'compaction_end':
              if (pendingNativeOverflowRecovery && event.reason === 'overflow') {
                pendingNativeOverflowRecovery = false
                const recovered = !event.aborted && event.result !== undefined && event.willRetry
                const terminalRetryError = retryTerminalGate.settle(
                  recovered || active.abortRequested || active.interrupting,
                )
                if (terminalRetryError) emitTerminalRetryError(terminalRetryError)
              }
              // 所有压缩结果都必须有可识别的终态，确保 renderer 能结束底部进度追踪。
              if (!event.aborted && event.result) {
                queue.push({
                  type: 'system',
                  subtype: 'compact_boundary',
                  session_id: session.sessionId,
                  summary: event.result.summary,
                  // 仅手动压缩展示 Pi 的压缩后预估值，自动压缩保持既有行为。
                  ...(event.reason === 'manual' && event.result.estimatedTokensAfter != null && {
                    compactionEstimatedTokensAfter: event.result.estimatedTokensAfter,
                  }),
                } as unknown as SDKMessage)
              } else if (event.aborted) {
                queue.push({
                  type: 'system',
                  subtype: 'status',
                  session_id: session.sessionId,
                  compact_result: 'failed',
                  compact_error: '上下文压缩已取消。',
                } as unknown as SDKMessage)
              } else if (event.errorMessage && !isCompactionNoopError(event.errorMessage)) {
                queue.push({
                  type: 'system',
                  subtype: 'status',
                  session_id: session.sessionId,
                  compact_result: 'failed',
                  compact_error: event.errorMessage,
                } as unknown as SDKMessage)
              }
              break
            case 'agent_settled':
              // 防御上游缺少 compaction_end 的异常事件序列，不能无限吞掉已 deferred 的错误。
              if (pendingNativeOverflowRecovery) {
                pendingNativeOverflowRecovery = false
                const terminalRetryError = retryTerminalGate.settle(active.abortRequested || active.interrupting)
                if (terminalRetryError) emitTerminalRetryError(terminalRetryError)
              }
              break
          }
        } catch (error) {
          queue.fail(error)
        }
      })

      if (input.compactRequest) {
        // 手动压缩：走 pi 原生 session.compact()，而非把 /compact 当普通 prompt 发给模型。
        // compaction_start/end 事件已在上面的 subscribe 中转成 compacting/compact_boundary system 消息；
        // compact() 不发 agent_end，故这里补一个合成 result 消息收束本轮（供 orchestrator 结束消费循环）。
        session.compact()
          .then(() => {
            queue.push({
              type: 'result',
              subtype: 'success',
              usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              terminal_reason: 'completed',
              isSyntheticCompactionResult: true,
              session_id: session.sessionId,
            } as unknown as SDKMessage)
            queue.close()
          })
          .catch((error) => {
            // 「会话太小无需压缩」/「已压缩」是良性情况，不是执行错误：
            // pi 会抛 "Nothing to compact (session too small)" / "Already compacted"。
            // 这里不 fail 队列（否则前端弹通用「执行错误」），改为正常收尾并给出友好提示。
            if (isCompactionNoopError(error)) {
              queue.push(createCompactionNoopMessage(session.sessionId, error))
              queue.push({
                type: 'result',
                subtype: 'success',
                usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                terminal_reason: 'completed',
                isSyntheticCompactionResult: true,
                session_id: session.sessionId,
              } as unknown as SDKMessage)
              queue.close()
            } else {
              queue.fail(error)
            }
          })
          .finally(cleanupActiveSession)
      } else {
        const runPromptChain = async (): Promise<void> => {
          let nextPrompt: {
            content: string
            skipSkillExpansion: boolean
            skillMentions?: string[]
            userMessageUuid?: string
            skipPiPromptExpansion?: boolean
          } | undefined = {
            content: appendOutputFormatInstruction(input.prompt, input.outputFormat),
            skipSkillExpansion: false,
            skillMentions: input.skillMentions,
            userMessageUuid: input.initialUserMessageUuid,
          }
          let nextInterrupt: PendingInterruptPrompt | undefined
          const unconsumedQueuedPrompts: string[] = []
          while (nextPrompt !== undefined) {
            const currentInterrupt = nextInterrupt
            nextInterrupt = undefined
            if (runtimeGuard.shouldStopBeforeNextTurn()) {
              currentInterrupt?.rejectAccepted(createAbortError())
              rejectPendingInterruptPrompts(active, createAbortError())
              return
            }
            const promptInput = nextPrompt
            let preparedPrompt: PreparedPromptWithSkills
            try {
              preparedPrompt = promptInput.skipSkillExpansion
                ? { content: promptInput.content, activations: [] }
                : await preparePromptWithGammaSkills(
                  resourceLoader,
                  promptInput.content,
                  promptInput.skillMentions,
                  input.skillWorkspaceSlug,
                )
            } catch (error) {
              currentInterrupt?.rejectAccepted(error)
              throw error
            }
            const prompt = preparedPrompt.content
            const skillActivationId = registerPromptSkillActivations(
              active,
              prompt,
              promptInput.userMessageUuid,
              preparedPrompt.activations,
            )
            nextPrompt = undefined
            try {
              if (active.abortRequested) {
                active.pendingSkillActivations.discard(skillActivationId)
                currentInterrupt?.rejectAccepted(createAbortError())
                rejectPendingInterruptPrompts(active, createAbortError())
                return
              }
              currentInterrupt?.resolveAccepted()
              await session.prompt(prompt, {
                source: 'rpc',
                ...(promptInput.skipPiPromptExpansion ? { expandPromptTemplates: false } : {}),
              })
              // SDK 入队可能晚于本轮最后一次队列检查。先关闭本轮接收，再把已经接受
              // 但尚未消费的消息带入 prompt chain，不能在 dispose 时静默丢弃。
              unconsumedQueuedPrompts.push(...await recoverUnconsumedPiQueuedMessages(
                active.queuedMessageAdmission,
                session,
                () => !active.abortRequested && !runtimeGuard.shouldStopBeforeNextTurn(),
              ))
              if (unconsumedQueuedPrompts.length > 0) pendingTerminalResult = undefined
              persistPiEntryBindings()
              if (compactContextRequested) {
                try {
                  await compactCurrentSessionAfterTurn(session, (message) => queue.push(message))
                } catch (error) {
                  // 用户在压缩期间停止时，Pi 会取消 summarization；这是正常中止而不是运行错误。
                  if (active.abortRequested) return
                  throw error
                }
                compactContextRequested = false
                const continuation = planPiCompactionContinuation({
                  continuationCount: automaticCompactionContinuations,
                  abortRequested: active.abortRequested,
                  runtimeLimitReached: runtimeGuard.shouldStopBeforeNextTurn(),
                })
                if (continuation.shouldContinue) {
                  automaticCompactionContinuations += 1
                  pendingCompactionContinuation = appendOutputFormatInstruction(continuation.prompt, input.outputFormat)
                  // 当前终态仅表示为执行压缩而结束的内部 loop，不应让上层把原任务视为完成。
                  pendingTerminalResult = undefined
                } else if (continuation.reason === 'continuation_limit') {
                  pendingTerminalResult = createCompactionContinuationLimitResult(session.sessionId)
                }
              }
              if (active.abortRequested || active.interrupting) {
                // Cancellation can arrive while Pi is compacting, after its first agent_end.
                // Do not render that stale terminal result before the next interrupt prompt starts.
                retryTerminalGate.settle(true)
                pendingNativeOverflowRecovery = false
                pendingTerminalResult = undefined
              } else if (pendingTerminalResult) {
                queue.push(pendingTerminalResult)
                pendingTerminalResult = undefined
              }
            } finally {
              if (active.interrupting) {
                session.agent.state.messages = dropTrailingAbortedAssistant(session.agent.state.messages)
              }
              active.interrupting = false
            }
            if (active.abortRequested) {
              rejectPendingInterruptPrompts(active, createAbortError())
              return
            }
            if (runtimeGuard.shouldStopBeforeNextTurn()) {
              rejectPendingInterruptPrompts(active, createAbortError())
              return
            }
            const pendingInterrupt = active.pendingInterruptPrompts.shift()
            nextInterrupt = pendingInterrupt
            if (pendingInterrupt) {
              nextPrompt = { content: pendingInterrupt.content, skipSkillExpansion: true }
            } else if (unconsumedQueuedPrompts.length > 0) {
              nextPrompt = {
                content: unconsumedQueuedPrompts.shift()!,
                skipSkillExpansion: true,
                skipPiPromptExpansion: true,
              }
            } else if (pendingCompactionContinuation) {
              nextPrompt = { content: pendingCompactionContinuation, skipSkillExpansion: true }
              pendingCompactionContinuation = undefined
            }
            if (nextPrompt !== undefined) active.queuedMessageAdmission.reopen()
          }
        }

        runPromptChain()
          .then(() => queue.close())
          .catch((error) => queue.fail(error))
          .finally(cleanupActiveSession)
      }
    } catch (error) {
      rejectActiveReady(active, error)
      queue.fail(error)
    }

    try {
      while (true) {
        const next = await queue.next()
        if (next.done) break
        yield next.value
      }
    } finally {
      cleanupActiveSession()
    }
  }

  abort(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active) return
    active.abortRequested = true
    active.queuedMessageAdmission.close()
    rejectPendingInterruptPrompts(active, createAbortError())
    if (!active.session) rejectActiveReady(active, createAbortError())
    active.session?.abortCompaction()
    active.session?.abort().catch(() => {})
  }

  async sendQueuedMessage(
    sessionId: string,
    message: SDKUserMessageInput,
    options?: SendQueuedMessageOptions,
  ): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) throw createInactiveQueueError()
    const assertCurrentSession = (): void => {
      if (active.abortRequested) throw createAbortError()
      if (active.disposed || this.activeSessions.get(sessionId) !== active) throw createInactiveQueueError()
      active.queuedMessageAdmission.assertOpen()
    }
    assertCurrentSession()
    const session = await waitForActiveSession(active)
    assertCurrentSession()
    if (active.runtimeGuard?.shouldStopBeforeNextTurn()) {
      session.agent.clearAllQueues()
      const stopOverride = active.runtimeGuard.getLimitResultOverride()
      throw new Error(stopOverride?.errors[0] ?? 'Agent 已达到运行限制，无法继续追加消息')
    }
    const preparedPrompt = active.resourceLoader
      ? await preparePromptWithGammaSkills(
        active.resourceLoader,
        message.message.content,
        options?.skillMentions,
        active.skillWorkspaceSlug,
      )
      : { content: message.message.content, activations: [] }
    assertCurrentSession()
    const content = preparedPrompt.content
    const referenceKey = message.uuid ?? randomUUID()
    active.referenceTurns?.register(referenceKey, content, options?.contextRefs ?? [])
    const skillActivationId = registerPromptSkillActivations(
      active,
      content,
      message.uuid,
      preparedPrompt.activations,
    )
    if (active.runtimeGuard?.shouldStopBeforeNextTurn()) {
      active.pendingSkillActivations.discard(skillActivationId)
      active.referenceTurns?.discard(referenceKey)
      session.agent.clearAllQueues()
      const stopOverride = active.runtimeGuard.getLimitResultOverride()
      throw new Error(stopOverride?.errors[0] ?? 'Agent 已达到运行限制，无法继续追加消息')
    }
    if (options?.interrupt) {
      const accepted = new Promise<void>((resolve, reject) => {
        active.pendingInterruptPrompts.push({
          content,
          skillActivationId,
          referenceKey,
          resolveAccepted: resolve,
          rejectAccepted: reject,
        })
      })
      accepted.catch(() => {})
      if (session.isStreaming) {
        // Pi 没有单独的 interrupt()；公开取消 API 是 abort()。
        // 这里把 abort 产生的内部 aborted 终态压住，再由 query 的 prompt chain 发送新消息。
        active.interrupting = true
        active.interruptAbortPromise ??= session.abort()
          .finally(() => {
            active.interruptAbortPromise = undefined
          })
        await active.interruptAbortPromise
      }
      await accepted
      options.onAccepted?.()
      return
    }
    try {
      await active.queuedMessageAdmission.admit(() => {
        assertCurrentSession()
        const enqueue = () => message.priority === 'now' ? session.steer(content) : session.followUp(content)
        return active.queuedMessageReceipts
          ? active.queuedMessageReceipts.submit(enqueue, () => !active.abortRequested && !active.disposed && this.activeSessions.get(sessionId) === active)
          : enqueue()
      })
    } catch (error) {
      active.pendingSkillActivations.discard(skillActivationId)
      active.referenceTurns?.discard(referenceKey)
      throw error
    }
    options?.onAccepted?.()
  }

  async cancelQueuedMessage(_sessionId: string, _messageUuid: string): Promise<void> {
    // Pi 的公开 SDK 当前只暴露 clearQueue，不支持按消息 UUID 删除。
  }

  async setPermissionMode(_sessionId: string, _mode: string): Promise<void> {
    // Gamma 权限由工具包装层实时读取 sessionPermissionModes，自身无需同步给 Pi。
  }

  dispose(): void {
    for (const active of this.activeSessions.values()) {
      active.queuedMessageAdmission.close()
      active.queuedMessageReceipts?.dispose()
      if (!active.disposed) {
        active.disposed = true
        rejectPendingInterruptPrompts(active, createAbortError())
        active.pendingSkillActivations.clear()
        active.session?.dispose()
      }
      rejectActiveReady(active, createAbortError())
    }
    this.activeSessions.clear()
  }
}
