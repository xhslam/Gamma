import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, chmodSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import { readAgentDesktopRefTarget } from './agent-desktop-ref-target'
import { resolveInstalledComputerApp, type InstalledComputerApp } from './computer-installed-app'
import type { ComputerRefTarget } from './computer-target-guard'
import { parseAgentDesktopEnvelope, type AgentDesktopEnvelope } from './agent-desktop-protocol'

const exec = promisify(execFile)
const MAX_OUTPUT = 24 * 1024 * 1024 // 24 MB

export interface AgentDesktopRunIdentity {
  root: string
  sessionId: string
}

/** 独立权限持有组件必须提供停止确认，不能把本地代理的退出当成真实执行者已退出。 */
export interface AgentDesktopCommand {
  executable: string
  argsPrefix?: string[]
  requireSuccessfulExit?: boolean
  prepare?(): Promise<void>
  stop?(identity: AgentDesktopRunIdentity): Promise<void>
}

interface ProcessRow {
  pid: number
  parent: number
  state: string
}

/** 可注入的进程控制边界；默认实现只控制当前 run 创建的进程。 */
interface ProcessControl {
  listProcesses(): Promise<ProcessRow[]>
  signal(pid: number, signal: NodeJS.Signals): void
  terminateWindows(pid: number): Promise<void>
}

async function processRows(): Promise<ProcessRow[]> {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,stat='], {
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (!stdout.trim()) throw new Error('进程枚举返回空结果，停止未确认')
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [pid, parent, state] = line.trim().split(/\s+/)
    const row = { pid: Number(pid), parent: Number(parent), state: state ?? '' }
    if (!Number.isInteger(row.pid) || row.pid <= 0 || !Number.isInteger(row.parent) || !row.state) {
      throw new Error('进程枚举返回无效记录')
    }
    return row
  })
}

const defaultProcessControl: ProcessControl = {
  listProcesses: processRows,
  signal: signalPid,
  async terminateWindows(pid) {
    const taskkill = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'taskkill.exe')
      : 'taskkill.exe'
    try {
      await exec(taskkill, ['/PID', String(pid), '/T', '/F'], { timeout: 5000 })
    } catch (error: unknown) {
      const err = error as { code?: number | string; stderr?: string; message?: string }
      if (
        err.code === 128 ||
        err.stderr?.includes('not found') ||
        err.stderr?.includes('没有找到') ||
        err.message?.includes('not found') ||
        err.message?.includes('没有找到')
      ) {
        return
      }
      throw error
    }
  },
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/**
 * agent-desktop 传输宿主。
 *
 * 管理私有 namespace 生命周期，通过固定路径直接执行 CLI，参数数组调用，绝不经 shell。
 * 严格单 run 串行执行，headed 物理输入全局互斥，超时与取消触发强停止屏障。
 */
export class AgentDesktopHost {
  private runs = new Map<string, RunHost>()
  private stopped = new Set<string>()
  private headedQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly command: () => AgentDesktopCommand,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly processControl: Partial<ProcessControl> = {},
  ) {}

  isStopped(namespace: string): boolean {
    return this.stopped.has(namespace)
  }

  async resolveInstalledApp(identifier: string): Promise<InstalledComputerApp | undefined> {
    return resolveInstalledComputerApp(identifier, this.platform)
  }

  async resolveRefTarget(namespace: string, ref: string): Promise<ComputerRefTarget> {
    const run = this.runs.get(namespace)
    if (!run || this.stopped.has(namespace)) throw new Error('引用不属于当前有效桌面运行')
    return run.resolveRefTarget(ref)
  }

  async execute(
    namespace: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs = 60_000,
    validate?: () => void,
  ): Promise<AgentDesktopEnvelope> {
    if (this.stopped.has(namespace) || signal?.aborted) {
      throw new Error('桌面运行已停止；不得重放')
    }

    const isHeaded = args.includes('--headed')
    if (isHeaded) {
      // 全局串行化 headed 物理输入
      let releaseHeaded!: () => void
      const nextHeaded = new Promise<void>((resolve) => {
        releaseHeaded = resolve
      })
      const prevHeaded = this.headedQueue
      this.headedQueue = this.headedQueue.then(() => nextHeaded)
      await prevHeaded
      try {
        return await this.executeInternal(namespace, args, signal, timeoutMs, validate)
      } finally {
        releaseHeaded()
      }
    }

    return await this.executeInternal(namespace, args, signal, timeoutMs, validate)
  }

  private async executeInternal(
    namespace: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs: number = 30_000,
    validate?: () => void,
  ): Promise<AgentDesktopEnvelope> {
    if (this.stopped.has(namespace) || signal?.aborted) {
      throw new Error('桌面运行已停止；不得重放')
    }

    validate?.()
    let run = this.runs.get(namespace)
    if (!run) {
      run = new RunHost(this.command(), namespace, this.platform, { ...defaultProcessControl, ...this.processControl })
      this.runs.set(namespace, run)
    }

    return await run.execute(args, signal, timeoutMs, validate)
  }

  async terminate(namespace?: string): Promise<void> {
    const entries = namespace !== undefined
      ? ([[namespace, this.runs.get(namespace)]] as const)
      : [...this.runs.entries()]

    for (const [id] of entries) {
      this.stopped.add(id)
    }

    await Promise.all(
      entries.map(async ([id, run]) => {
        if (run) {
          await run.terminate()
          this.runs.delete(id)
        }
      }),
    )
  }
}

class RunHost {
  private root: string
  private readonly desktopSessionId: string
  private currentChild?: ChildProcess
  private inFlight = false
  private closed = false
  private stopping?: Promise<void>
  private dispatched = false
  private childClosed?: Promise<void>
  private owned = new Set<number>()

  constructor(
    private command: AgentDesktopCommand,
    namespace: string,
    private platform: NodeJS.Platform,
    private readonly processControl: ProcessControl,
  ) {
    // 上游 session 只允许 1–64 个安全字符；完整摘要避免直接替换或截断造成碰撞。
    // 原始 namespace 仍由 AgentDesktopHost 管理，停止和隔离语义不变。
    this.desktopSessionId = createHash('sha256').update(namespace).digest('hex')
    const raw = mkdtempSync(join(tmpdir(), 'gamma-ad-'))
    this.root = existsSync(raw) ? realpathSync(raw) : raw
    try {
      chmodSync(this.root, 0o700)
    } catch {}
    mkdirSync(join(this.root, 'state'), { mode: 0o700 })
  }

  resolveRefTarget(ref: string): ComputerRefTarget {
    if (this.closed || this.inFlight) throw new Error('桌面引用当前不可核验')
    return readAgentDesktopRefTarget(this.root, this.desktopSessionId, ref)
  }

  async execute(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutMs: number,
    validate?: () => void,
  ): Promise<AgentDesktopEnvelope> {
    if (this.closed || signal?.aborted) {
      throw new Error('桌面执行者已停止')
    }
    if (this.inFlight) {
      throw new Error('同一 namespace 不允许并发命令')
    }

    this.inFlight = true
    const boundedTimeout = Math.max(100, Math.min(timeoutMs, 120_000))

    try {
      if (this.command.prepare) await this.command.prepare()
      if (this.closed || signal?.aborted) throw new Error('桌面执行者已停止；未投递命令')
      validate?.()
      return await new Promise<AgentDesktopEnvelope>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let stdout = ''
        let outputBytes = 0
        const decoder = new StringDecoder('utf8')
        let completed = false

        const cleanUp = () => {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          this.inFlight = false
        }

        const stopAndReject = (message: string) => {
          if (completed) return
          completed = true
          void this.terminate().then(
            () => { cleanUp(); reject(new Error(message)) },
            (error: unknown) => {
              cleanUp()
              reject(new Error(`${message}；进程树停止未确认`, { cause: error }))
            },
          )
        }
        const onAbort = () => stopAndReject('桌面操作已停止；投递状态未知，不得重试')

        signal?.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => {
          stopAndReject('agent-desktop 执行超时；投递状态未知，不得重试')
        }, boundedTimeout)

        if (signal?.aborted) {
          onAbort()
          return
        }

        this.dispatched = true
        const isWin = this.platform === 'win32'
        const env: NodeJS.ProcessEnv = {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          SystemRoot: process.env.SystemRoot,
          LANG: 'en_US.UTF-8',
          TMPDIR: process.env.TMPDIR || tmpdir(),
          AGENT_DESKTOP_HOME: join(this.root, 'state'),
          AGENT_DESKTOP_SESSION: this.desktopSessionId,
          AGENT_DESKTOP_NO_UPDATE_NOTIFIER: '1',
          ...(isWin
            ? {
                SystemDrive: process.env.SystemDrive || 'C:',
                TEMP: process.env.TEMP || tmpdir(),
                TMP: process.env.TMP || tmpdir(),
                APPDATA: process.env.APPDATA,
                LOCALAPPDATA: process.env.LOCALAPPDATA,
                COMSPEC: process.env.COMSPEC,
                windir: process.env.windir || process.env.SystemRoot,
              }
            : {}),
        }
        const child = spawn(this.command.executable, [...(this.command.argsPrefix ?? []), ...args], {
          shell: false,
          detached: !isWin,
          cwd: this.root,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

        this.currentChild = child
        if (child.pid) this.owned.add(child.pid)
        this.childClosed = new Promise<void>((resolveClose) => {
          child.once('close', () => {
            if (this.currentChild === child) this.currentChild = undefined
            resolveClose()
          })
        })

        child.stdout.on('data', (chunk: Buffer) => {
          if (completed) return
          outputBytes += chunk.length
          if (outputBytes > MAX_OUTPUT) {
            stopAndReject('agent-desktop 响应超出有界输出；投递状态未知')
            return
          }
          stdout += decoder.write(chunk)
        })

        // 丢弃 stderr，避免桌面原文泄露到日志
        child.stderr.on('data', () => {})

        child.once('error', (err) => {
          if (completed) return
          completed = true
          cleanUp()
          reject(
            new Error(`agent-desktop 启动失败: ${err.message}；未返回桌面原文`),
          )
        })

        child.once('close', (code) => {
          if (completed) return
          if (this.command.requireSuccessfulExit && code !== 0) {
            stopAndReject('独立桌面代理未确认完成；投递状态未知，不得重试')
            return
          }
          completed = true
          if (!this.closed) this.owned.clear()
          cleanUp()

          const trimmed = (stdout + decoder.end()).trim()
          if (!trimmed) {
            reject(
              new Error(
                `agent-desktop 执行者退出（exit code ${code}）；投递状态未知，不得重试`,
              ),
            )
            return
          }

          try {
            const envelope = parseAgentDesktopEnvelope(trimmed)
            resolve(envelope)
          } catch (err) {
            reject(err)
          }
        })
      })
    } finally {
      this.inFlight = false
    }
  }

  terminate(): Promise<void> {
    if (this.stopping) return this.stopping
    this.closed = true

    this.stopping = (async () => {
      // 服务端并非代理的后代进程。先取得真实执行者的停止 ACK，再回收本地代理和私有引用目录。
      if (this.dispatched) await this.command.stop?.({ root: this.root, sessionId: this.desktopSessionId })
      const child = this.currentChild
      if (this.platform === 'win32') {
        const pid = child?.pid ?? this.owned.values().next().value
        if (pid !== undefined) await this.processControl.terminateWindows(pid)
      } else if (this.owned.size) {
        // 先冻结父进程，再逐层冻结后代；枚举或信号失败必须保留所有权以供停止重试。
        for (const pid of this.owned) this.processControl.signal(pid, 'SIGSTOP')
        let stable = false
        for (let pass = 0; pass < 8; pass++) {
          const rows = await this.processControl.listProcesses()
          let changed = false
          for (const row of rows) {
            if (this.owned.has(row.parent) && !this.owned.has(row.pid)) {
              this.owned.add(row.pid)
              this.processControl.signal(row.pid, 'SIGSTOP')
              changed = true
            }
          }
          if (!changed) { stable = true; break }
        }
        if (!stable) throw new Error('进程树枚举未收敛，停止未确认')
        for (const pid of [...this.owned].reverse()) this.processControl.signal(pid, 'SIGKILL')

        const deadline = Date.now() + 3000
        while (true) {
          const rows = await this.processControl.listProcesses()
          // 僵尸已退出且不能执行操作，无需等待系统父进程完成回收。
          const alive = rows.some((row) => this.owned.has(row.pid) && !row.state.startsWith('Z'))
          if (!alive) break
          if (Date.now() >= deadline) throw new Error('进程树仍在运行，停止未确认')
          await new Promise<void>((resolve) => setTimeout(resolve, 25))
        }
      }
      if (this.childClosed) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            this.childClosed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('执行者 close 未确认')), 3000)
            }),
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      this.owned.clear()
      if (existsSync(this.root)) rmSync(this.root, { recursive: true, force: true })
    })().catch((error: unknown) => {
      this.stopping = undefined
      throw error
    })

    return this.stopping
  }
}
