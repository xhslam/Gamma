import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, chmodSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseAgentDesktopEnvelope, type AgentDesktopEnvelope } from './agent-desktop-protocol'

const exec = promisify(execFile)
const MAX_OUTPUT = 24 * 1024 * 1024 // 24 MB

interface ProcessRow {
  pid: number
  parent: number
  state: string
}

async function processRows(): Promise<ProcessRow[]> {
  try {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,stat='], {
      timeout: 2000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [pid, parent, state] = line.trim().split(/\s+/)
        return { pid: Number(pid), parent: Number(parent), state: state ?? '' }
      })
  } catch {
    return []
  }
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
    private readonly command: () => { executable: string },
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  isStopped(namespace: string): boolean {
    return this.stopped.has(namespace)
  }

  async execute(
    namespace: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs = 60_000,
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
        return await this.executeInternal(namespace, args, signal, timeoutMs)
      } finally {
        releaseHeaded()
      }
    }

    return await this.executeInternal(namespace, args, signal, timeoutMs)
  }

  private async executeInternal(
    namespace: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs: number = 30_000,
  ): Promise<AgentDesktopEnvelope> {
    if (this.stopped.has(namespace) || signal?.aborted) {
      throw new Error('桌面运行已停止；不得重放')
    }

    let run = this.runs.get(namespace)
    if (!run) {
      run = new RunHost(this.command().executable, namespace, this.platform)
      this.runs.set(namespace, run)
    }

    return await run.execute(args, signal, timeoutMs)
  }

  async terminate(namespace?: string): Promise<void> {
    const entries = namespace
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
  private currentChild?: ChildProcess
  private inFlight = false
  private closed = false
  private stopping?: Promise<void>

  constructor(
    private executable: string,
    private namespace: string,
    private platform: NodeJS.Platform,
  ) {
    const raw = mkdtempSync(join(tmpdir(), 'gamma-ad-'))
    this.root = existsSync(raw) ? realpathSync(raw) : raw
    try {
      chmodSync(this.root, 0o700)
    } catch {}
    mkdirSync(join(this.root, 'state'), { mode: 0o700 })
  }

  async execute(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutMs: number,
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
      return await new Promise<AgentDesktopEnvelope>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let stdout = ''
        let completed = false

        const cleanUp = () => {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          this.currentChild = undefined
          this.inFlight = false
        }

        const onAbort = () => {
          if (completed) return
          completed = true
          void this.terminate().finally(() => {
            cleanUp()
            reject(new Error('桌面操作已停止；投递状态未知，不得重试'))
          })
        }

        signal?.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => {
          if (completed) return
          completed = true
          void this.terminate().finally(() => {
            cleanUp()
            reject(new Error('agent-desktop 执行超时；投递状态未知，不得重试'))
          })
        }, boundedTimeout)

        if (signal?.aborted) {
          onAbort()
          return
        }

        const child = spawn(this.executable, args, {
          shell: false,
          detached: this.platform !== 'win32',
          cwd: this.root,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            USERPROFILE: process.env.USERPROFILE,
            SystemRoot: process.env.SystemRoot,
            LANG: 'en_US.UTF-8',
            TMPDIR: process.env.TMPDIR || tmpdir(),
            AGENT_DESKTOP_HOME: join(this.root, 'state'),
            AGENT_DESKTOP_SESSION: this.namespace,
            AGENT_DESKTOP_NO_UPDATE_NOTIFIER: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })

        this.currentChild = child

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
          if (Buffer.byteLength(stdout) > MAX_OUTPUT) {
            if (!completed) {
              completed = true
              void this.terminate().finally(() => {
                cleanUp()
                reject(new Error('agent-desktop 响应超出有界输出；投递状态未知'))
              })
            }
          }
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
          completed = true
          cleanUp()

          const trimmed = stdout.trim()
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
      const child = this.currentChild
      if (child && child.pid) {
        if (this.platform === 'win32') {
          await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            timeout: 5000,
          }).catch(() => {})
        } else {
          // 冻结并回收进程树
          signalPid(child.pid, 'SIGSTOP')
          const owned = new Set([child.pid])
          for (let pass = 0; pass < 8; pass++) {
            const rows = await processRows()
            let changed = false
            for (const row of rows) {
              if (owned.has(row.parent) && !owned.has(row.pid)) {
                owned.add(row.pid)
                signalPid(row.pid, 'SIGSTOP')
                changed = true
              }
            }
            if (!changed) break
          }
          for (const pid of [...owned].reverse()) {
            signalPid(pid, 'SIGKILL')
          }
        }
      }

      if (existsSync(this.root)) {
        try {
          rmSync(this.root, { recursive: true, force: true })
        } catch {}
      }
    })()

    return this.stopping
  }
}
