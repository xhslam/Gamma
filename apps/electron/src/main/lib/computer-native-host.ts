import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { ComputerHost } from './computer-controller'

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export interface ComputerHostCommand { executable: string; args?: string[] }
/** 私有 stdio 通道：不暴露任意可执行路径给 renderer/模型，不记录观察 payload。 */
export class ComputerNativeHost implements ComputerHost {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, Pending>()
  private stopping?: Promise<void>
  private listeners = new Set<() => void>()
  constructor(private readonly command: () => ComputerHostCommand, private readonly options: { maxLineBytes?: number } = {}) {}
  onStopped(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private start(): ChildProcessWithoutNullStreams {
    if (this.stopping) throw new Error('原生 helper 正在停止')
    if (this.child) return this.child
    const { executable, args } = this.command()
    const child = spawn(executable, args ?? [], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, LANG: 'en_US.UTF-8' } })
    this.child = child
    const decoder = new StringDecoder('utf8')
    let buffered = ''
    const fail = (): void => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('原生 helper 失联；不能推断操作未执行')) }
      this.pending.clear()
      for (const listener of this.listeners) { try { listener() } catch { /* 不阻塞安全回收。 */ } }
    }
    child.on('error', fail)
    child.on('close', () => { if (this.child === child) this.child = undefined; fail() })
    child.stdin.on('error', fail)
    // stderr 不进通用日志，避免错误路径夹带AX或图像；始终消费防止子进程堵塞。
    child.stderr.on('data', () => {})
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += decoder.write(chunk)
      if (Buffer.byteLength(buffered) > (this.options.maxLineBytes ?? 24 * 1024 * 1024)) { fail(); child.kill('SIGKILL'); return }
      let end: number
      while ((end = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        try {
          const response: unknown = JSON.parse(line)
          if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error()
          const message = response as Record<string, unknown>
          if (message.event === 'stopped') { fail(); continue }
          if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') throw new Error()
          const item = this.pending.get(message.id)
          if (!item) continue // 超时/撤权后的迟到回包没有复活能力。
          clearTimeout(item.timer)
          this.pending.delete(message.id)
          if (message.ok) item.resolve(message.result)
          else item.reject(new Error('原生操作未完成；请检查权限、目标与本地确认'))
        } catch { fail(); child.kill('SIGKILL'); return }
      }
    })
    return child
  }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    if (!['status', 'requestPermission', 'select', 'observe', 'screenshot', 'openApp', 'perform'].includes(method)) return Promise.reject(new Error('未允许的原生方法'))
    if (this.stopping) return Promise.reject(new Error('原生 helper 正在停止'))
    const id = randomUUID()
    const line = JSON.stringify({ id, method, params }) + '\n'
    if (Buffer.byteLength(line) > 1024 * 1024) return Promise.reject(new Error('原生请求过大'))
    const child = this.start()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('原生操作超时；副作用可能未知，禁止自动重试'))
        void this.terminate().catch(() => {})
      }, Math.min(Math.max(timeoutMs, 50), 120_000))
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(line, error => {
        if (!error) return
        const pending = this.pending.get(id)
        if (pending) { clearTimeout(pending.timer); this.pending.delete(id); pending.reject(new Error('原生通道已断开')) }
      })
    })
  }
  terminate(): Promise<void> {
    if (this.stopping) return this.stopping
    const child = this.child
    if (!child) return Promise.resolve()
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('原生操作已停止；副作用可能未知')) }
    this.pending.clear()
    const stopping = new Promise<void>((resolve, reject) => {
      let done = false
      const finish = (error?: Error): void => {
        if (done) return
        done = true
        clearTimeout(termTimer); clearTimeout(killTimer); clearTimeout(deadline)
        child.removeListener('close', onClose)
        if (error) reject(error)
        else { if (this.child === child) this.child = undefined; resolve() }
      }
      const onClose = (): void => finish()
      child.once('close', onClose)
      // 先请求原生撤权/抬键，再有界结束进程；不依赖AX线程或模型完成。
      child.stdin.write(JSON.stringify({ id: randomUUID(), method: 'stop', params: { reason: 'parent-stop' } }) + '\n', () => {})
      const termTimer = setTimeout(() => child.kill('SIGTERM'), 250)
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1000)
      const deadline = setTimeout(() => finish(new Error('旧原生进程未证明退出')), 3000)
    }).finally(() => { if (this.stopping === stopping) this.stopping = undefined })
    this.stopping = stopping
    return stopping
  }
}
