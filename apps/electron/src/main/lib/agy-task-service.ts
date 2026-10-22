import { randomUUID } from 'node:crypto'
import { spawn as spawnProcess } from 'node:child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { join } from 'node:path'
import type { AgyActivityEvent, AgyTask, AgyTaskStartInput, AgyTaskStatus, AgyTaskUpdate } from '@gamma/shared'
import { AgyTaskStore, AGY_MAX_EVENTS, AGY_MAX_LOG_BYTES } from './agy-task-store'
import { AgyStreamParser, redactAgyText, redactAgyValue } from './agy-stream-parser'
import { resolveAgentTerminalCwd } from './terminal-agent-policy'
import { createAgyEnvironment, createAgyInvocation, formatAgyLaunchError, resolveAgyExecutable } from './agy-process-launch'

export interface AgyTaskContext {
  workbench: string
  allowedRoots: string[]
}
interface AgyServiceDependencies {
  context(sessionId: string): AgyTaskContext
  notify(update: AgyTaskUpdate): void
  spawn?: (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams
  executable?: string
  /** 仅用于无云端测试；生产环境不得由工具或 renderer 指定。 */
  stopProcess?: (child: ChildProcessWithoutNullStreams, force: boolean) => void
}
interface LiveTask {
  task: AgyTask
  store: AgyTaskStore
  child?: ChildProcessWithoutNullStreams
  parser: AgyStreamParser
  pending: AgyActivityEvent[]
  totalBytes: number
  result?: Record<string, unknown>
  protocolError: boolean
  timeoutSeen: boolean
  stopStatus?: AgyTaskStatus
  finished: boolean
  completion: Promise<AgyTask>
  complete: (task: AgyTask) => void
  flushTimer?: ReturnType<typeof setTimeout>
  timeout?: ReturnType<typeof setTimeout>
  killTimer?: ReturnType<typeof setTimeout>
  drainTimer?: ReturnType<typeof setTimeout>
  removeAbort?: () => void
  stderrTail: string
  hasSchemaInput?: boolean
}

const ACTIVE = new Set<AgyTaskStatus>(['starting', 'running', 'stopping'])
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }

/** 外部 CLI 任务管理；不拥有 agy 自身的文件/网络权限，也不伪造 Pi 会话。 */
export class AgyTaskService {
  private readonly live = new Map<string, LiveTask>()
  private readonly calls = new Map<string, string>()
  private readonly recovered = new Set<string>()
  private closing = false
  constructor(private readonly dependencies: AgyServiceDependencies) {}

  private store(sessionId: string): AgyTaskStore {
    const context = this.dependencies.context(sessionId)
    const store = new AgyTaskStore(join(context.workbench, 'agy-tasks'))
    if (!this.recovered.has(sessionId)) {
      for (const task of store.list(sessionId)) {
        if (ACTIVE.has(task.status) && !this.live.has(task.id)) {
          task.status = 'interrupted'
          task.error = 'Gamma 上次运行已结束，外部任务未自动续跑；无法确认服务端工作状态。'
          task.completedAt = Date.now()
          store.save(task, [])
        }
      }
      this.recovered.add(sessionId)
    }
    return store
  }

  start(sessionId: string, input: AgyTaskStartInput, toolCallId: string, signal?: AbortSignal, authorizedRoots: string[] = []): AgyTask {
    if (this.closing || signal?.aborted) throw new Error('外部任务启动已取消')
    const key = `${sessionId}:${toolCallId}`
    const previous = this.calls.get(key)
    if (previous) return this.get(sessionId, previous)
    if ([...this.live.values()].filter(item => !item.finished).length >= 4) throw new Error('外部任务并发上限为 4')
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 200_000) throw new Error('任务提示词必须为 1–200000 字符')
    if (input.model && !/^[a-zA-Z0-9._-]{1,120}$/.test(input.model)) throw new Error('无效 agy 模型 ID')
    const seconds = input.timeoutSeconds ?? 300
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) throw new Error('超时需为 5–3600 秒整数')
    if (input.schema) {
      if (input.schema.length > 32_000 || !record(JSON.parse(input.schema))) throw new Error('schema 必须为 JSON Schema 对象')
    }
    const context = this.dependencies.context(sessionId)
    const cwd = resolveAgentTerminalCwd({ agentCwd: context.workbench, allowedRoots: [...context.allowedRoots, ...authorizedRoots], cwd: input.cwd })
    const store = this.store(sessionId)
    const task: AgyTask = {
      id: randomUUID(), sessionId, title: redactAgyText(input.title?.slice(0, 120) || 'agy 外部任务'),
      prompt: redactAgyText(input.prompt), model: input.model, cwd, status: 'starting', startedAt: Date.now(), lastSequence: 0,
    }
    let complete!: (task: AgyTask) => void
    const completion = new Promise<AgyTask>(resolve => { complete = resolve })
    const run: LiveTask = {
      task, store, parser: new AgyStreamParser(event => this.onEvent(run, event)), pending: [], totalBytes: 0,
      protocolError: false, timeoutSeen: false, finished: false, completion, complete, stderrTail: '',
    }
    store.save(task, [])
    this.live.set(task.id, run)
    this.calls.set(key, task.id)
    // 已结束任务不需要保留进程与 Promise；幂等 ID 保留有界窗口，历史仍从工作台读取。
    if (this.calls.size > 1000) this.calls.delete(this.calls.keys().next().value!)
    this.dependencies.notify({ task: { ...task }, events: [], reveal: true })
    const args = ['--output-format', 'stream-json', '--disable-slash-commands', '--print-timeout', `${seconds}s`]
    if (input.model) args.push('--model', input.model)
    let executable: string | undefined
    try {
      executable = resolveAgyExecutable({ executable: this.dependencies.executable })
      // 不把任意 JSON 放进 cmd 命令行，也避免 Windows 8191/32767 字符上限与多行转义。
      if (input.schema) {
        const path = store.writeSchemaInput(task.id, input.schema)
        run.hasSchemaInput = true
        args.push('--json-schema', path)
      }
      const env = createAgyEnvironment()
      const invocation = createAgyInvocation(executable, args, env)
      const child = (this.dependencies.spawn ?? spawnProcess)(invocation.command, invocation.args, {
        cwd, env, shell: false, detached: process.platform !== 'win32', stdio: 'pipe', windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      }) as ChildProcessWithoutNullStreams
      run.child = child
      child.once('spawn', () => {
        if (run.finished || run.stopStatus) return
        task.status = 'running'
        this.flush(run)
      })
      child.stdout.on('data', (chunk: Buffer) => { if (!run.finished) run.parser.push(chunk) })
      child.stderr.on('data', (chunk: Buffer) => {
        if (run.finished) return
        const text = chunk.toString('utf8')
        // 错误文本只按换行/有界缓冲脱敏，避免把跨 chunk 的 token 半截写入日志。
        run.stderrTail += text
        if (/print timeout|cannot prompt for|auto-denied/i.test(run.stderrTail)) {
          if (/print timeout/i.test(run.stderrTail)) run.timeoutSeen = true
          else task.error = 'agy 工具权限被拒绝；没有自动放宽权限。'
        }
        const newline = run.stderrTail.lastIndexOf('\n')
        if (newline >= 0) {
          this.append(run, { kind: 'stderr', text: redactAgyText(run.stderrTail.slice(0, newline + 1)) })
          run.stderrTail = run.stderrTail.slice(newline + 1)
        }
        if (run.stderrTail.length > 8192) {
          run.stderrTail = ''
          this.append(run, { kind: 'warning', text: '过长 stderr 行已省略。' })
        }
      })
      child.on('error', error => {
        if (run.finished) return
        task.error = redactAgyText(formatAgyLaunchError(error, executable, cwd))
        this.finish(run, run.stopStatus ?? 'failed')
      })
      child.on('exit', (code: number | null) => {
        task.exitCode = code ?? undefined
        // 独立后代可能继承管道，leader exit 后不能无限等待 close。
        if (!run.finished && !run.drainTimer) run.drainTimer = setTimeout(() => this.forceDrain(run), 2000)
      })
      child.on('close', (code: number | null) => {
        if (run.finished) return
        run.parser.finish()
        if (run.stderrTail) this.append(run, { kind: 'stderr', text: redactAgyText(run.stderrTail) })
        task.exitCode = code ?? undefined
        const validResult = run.result?.status === 'SUCCESS' && (Boolean(task.response?.trim()) || run.result?.structured_output !== undefined)
        const status = run.stopStatus ?? (run.timeoutSeen ? 'timed_out' : code === 0 && validResult && !run.protocolError && !task.error ? 'completed' : 'failed')
        if (status === 'failed' && !task.error) task.error = 'agy 未提供有效成功终态，或进程异常退出；部分输出不代表完成。'
        this.finish(run, status)
      })
      child.stdin.on('error', error => {
        if (!run.finished && !run.result) { task.error = redactAgyText(`agy 输入失败：${error.message}`); this.requestStop(run, 'failed') }
      })
      child.stdin.end(input.prompt, 'utf8')
      run.timeout = setTimeout(() => this.requestStop(run, 'timed_out'), seconds * 1000 + 5000)
      const abort = (): void => { if (!run.finished) this.requestStop(run, 'cancelled') }
      signal?.addEventListener('abort', abort, { once: true })
      run.removeAbort = () => signal?.removeEventListener('abort', abort)
      if (signal?.aborted) abort()
      this.flush(run)
    } catch (error) {
      task.error = redactAgyText(formatAgyLaunchError(error, executable, cwd))
      this.finish(run, 'failed')
    }
    return { ...task }
  }

  private onEvent(run: LiveTask, event: Omit<AgyActivityEvent, 'sequence' | 'timestamp'>): void {
    const details = record(event.details)
    if (event.kind === 'init' && details) {
      run.task.permissionMode = string(details.permission_mode)
      // conversation_id 有的版本放在外层，有的放在 init 中；不从模型正文猜测。
      run.task.conversationId = string(details.conversation_id)
      if (/bypass|skip|auto-approve/i.test(run.task.permissionMode ?? '')) {
        this.append(run, { kind: 'warning', text: 'agy 报告了宽松权限模式；该模式可能来自它自己的配置。本面板不是文件/网络沙箱。' })
      }
    }
    if (event.kind === 'result' && details) {
      run.result = details
      run.task.conversationId = string(details.conversation_id) ?? run.task.conversationId
      // 最终结果独立于日志摘要保留，不能从已裁剪的活动日志还原结构化批量结果。
      run.task.response = string(details.response)
      run.task.structuredOutput = details.structured_output
      const usage = record(details.usage)
      if (usage) run.task.usage = Object.fromEntries(Object.entries(usage).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
      if (typeof details.duration_seconds === 'number') run.task.durationSeconds = details.duration_seconds
      if (details.status !== 'SUCCESS') run.task.error = `agy 返回状态：${String(details.status).slice(0, 100)}`
    }
    if (event.kind === 'warning') {
      run.protocolError = true
      if (event.text?.includes('最终结果不完整')) {
        run.task.outputIncomplete = true
        run.task.error = '最终结果不完整，不能当作完整成功结果交付。'
      }
    }
    this.append(run, event)
  }

  private append(run: LiveTask, event: Omit<AgyActivityEvent, 'sequence' | 'timestamp'>): void {
    if (run.finished || run.task.truncated) return
    const safe = redactAgyValue(event.kind === 'result'
      ? { ...event, text: '活动详情为有界脱敏摘要；完整结果请查看独立最终结果。' }
      : event) as typeof event
    const bytes = Buffer.byteLength(JSON.stringify(safe))
    if (run.task.lastSequence >= AGY_MAX_EVENTS || run.totalBytes + bytes > AGY_MAX_LOG_BYTES) {
      run.task.truncated = true
      run.pending.push({ sequence: ++run.task.lastSequence, timestamp: Date.now(), kind: 'warning', text: '日志达到保留上限，后续活动未保存；最终结果仍单独保留。' })
    } else {
      run.totalBytes += bytes
      run.pending.push({ ...safe, sequence: ++run.task.lastSequence, timestamp: Date.now() })
    }
    if (!run.flushTimer) run.flushTimer = setTimeout(() => this.flush(run), 100)
  }

  private flush(run: LiveTask): void {
    clearTimeout(run.flushTimer)
    run.flushTimer = undefined
    const events = run.pending.splice(0)
    try {
      run.store.save(run.task, events)
      this.dependencies.notify({ task: { ...run.task }, events })
    } catch {
      run.task.error = '任务日志写入失败，已停止外部进程。'
      if (run.finished) {
        run.task.status = 'failed'
        this.terminate(run, true)
        this.dependencies.notify({ task: { ...run.task }, events: [] })
      } else this.requestStop(run, 'failed')
    }
  }

  private terminate(run: LiveTask, force: boolean): void {
    const child = run.child
    if (!child) return
    try {
      if (this.dependencies.stopProcess) this.dependencies.stopProcess(child, force)
      else if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
      else if (child.pid) spawnProcess('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { shell: false, windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    } catch { try { child.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* 进程可能已经退出 */ } }
  }

  private requestStop(run: LiveTask, status: AgyTaskStatus): void {
    if (run.finished || run.stopStatus) return
    run.stopStatus = status
    run.task.status = 'stopping'
    if (status === 'timed_out') run.task.error = '外部任务超时，部分输出不代表完成。'
    this.terminate(run, false)
    run.killTimer = setTimeout(() => {
      this.terminate(run, true)
      if (!run.finished && !run.drainTimer) run.drainTimer = setTimeout(() => this.forceDrain(run), 1000)
    }, 1500)
    // flush 的持久化失败路径不能递归 requestStop。
    this.dependencies.notify({ task: { ...run.task }, events: [] })
  }

  private forceDrain(run: LiveTask): void {
    if (run.finished) return
    run.parser.finish()
    run.task.error = [run.task.error, 'CLI 或输出管道未正常收束，已关闭本地观察连接；无法确认独立后代或服务端工作是否结束。'].filter(Boolean).join('\n')
    this.terminate(run, true)
    run.child?.stdin.destroy()
    run.child?.stdout.destroy()
    run.child?.stderr.destroy()
    this.finish(run, run.stopStatus ?? 'failed')
  }

  private finish(run: LiveTask, status: AgyTaskStatus): void {
    if (run.finished) return
    clearTimeout(run.timeout)
    clearTimeout(run.killTimer)
    clearTimeout(run.drainTimer)
    run.removeAbort?.()
    if (run.hasSchemaInput) {
      try { run.store.clearSchemaInput(run.task.id) } catch {
        this.append(run, { kind: 'warning', text: '临时 Schema 文件清理失败，仍保留在当前任务的私有目录。' })
      }
    }
    run.task.status = status
    run.task.completedAt = Date.now()
    run.finished = true
    this.flush(run)
    run.complete({ ...run.task })
    // 写盘失败仍保留最终内存状态，避免回查旧的 running 元数据造成成功/失败误判。
    if (run.task.error !== '任务日志写入失败，已停止外部进程。') this.live.delete(run.task.id)
  }

  get(sessionId: string, id: string): AgyTask {
    const store = this.store(sessionId)
    const task = this.live.get(id)?.task ?? store.get(id)
    if (!task || task.sessionId !== sessionId) throw new Error('外部任务不存在或不属于当前会话')
    return { ...task }
  }
  list(sessionId: string): AgyTask[] { return this.store(sessionId).list(sessionId) }
  read(sessionId: string, id: string, afterSequence = 0) {
    const task = this.get(sessionId, id)
    const run = this.live.get(id)
    if (run) this.flush(run)
    return this.store(sessionId).read(task, afterSequence)
  }
  async wait(sessionId: string, id: string, seconds = 60, signal?: AbortSignal): Promise<AgyTask> {
    this.get(sessionId, id)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error('等待时间需为 1–300 秒')
    const run = this.live.get(id)
    if (!run) return this.get(sessionId, id)
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      await Promise.race([run.completion, new Promise<void>((resolve, reject) => {
        timer = setTimeout(resolve, seconds * 1000)
        abort = () => reject(new Error('等待已取消；外部任务是否结束请查询状态'))
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })])
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort) }
    return this.get(sessionId, id)
  }
  async stop(sessionId: string, id: string): Promise<AgyTask> {
    this.get(sessionId, id)
    const run = this.live.get(id)
    if (run) { this.requestStop(run, 'cancelled'); await run.completion }
    return this.get(sessionId, id)
  }
  async stopSession(sessionId: string): Promise<void> {
    await Promise.all([...this.live.values()].filter(run => run.task.sessionId === sessionId).map(run => this.stop(sessionId, run.task.id)))
  }
  shutdown(): void {
    this.closing = true
    for (const run of this.live.values()) {
      this.terminate(run, true)
      this.finish(run, 'interrupted')
    }
  }
}
