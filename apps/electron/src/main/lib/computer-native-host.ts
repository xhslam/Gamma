import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { ComputerHost } from './computer-controller'
import type { ComputerPermission } from '@gamma/shared'

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export interface ComputerHostCommand { executable: string; args?: string[] }
const NATIVE_REASONS: Readonly<Record<string, string>> = {
  'permission-required': '系统权限未授予或已撤销',
  'secure-input': '系统安全输入禁止注入',
  'input-held': '检测到按住的按键或鼠标按钮',
  'preparation-required': '动作准备已失效，请重新观察',
  'stale-observation': '观察已过期或动作不可重放',
  'display-changed': '显示器布局已改变，请重新观察',
  'observation-layout-changed': '前台布局已改变或无法验证，请先聚焦目标窗口并重新截图',
  'desktop-changed': '桌面布局已改变，请重新观察',
  'target-changed': '目标应用或控件已改变，请重新观察',
  'focus-changed': '输入焦点已改变，请重新观察',
  'application-not-found': '未找到唯一的应用',
  'ambiguous-application': '存在多个应用进程，无法唯一授权',
  'invalid-application': '应用名称或标识无效',
  'unsafe-focus': '无法验证实际输入焦点',
  'untrusted-surface': '目标属于Gamma或不可授权的系统界面',
  'unknown-target': '无法验证实际目标控件',
  'cross-application-drag': '暂不支持跨应用拖拽',
  'revoked': '原生授权已停止或失效',
  'busy': '原生操作仍在进行',
  'stale-element': '元素引用已失效，请重新获取应用状态',
  'stale-element-ref': '元素引用已失效，请重新获取应用状态',
  'application-mismatch': '实际接收应用与指定应用不一致，动作未投递',
  'unsupported-format': '当前仅支持 text/md 的 AX 选区插入，不支持 HTML 富文本',
  'invalid-selection': '无法验证当前文本选区，请重新观察或使用 set_value',
  'selection-changed': '文本或选区已改变，动作未投递，请重新观察',
  'text-budget': '文本插入超过安全预算，动作未投递',
  'unsupported-action': '该控件不支持所选 AX 动作，请重新观察或使用截图兜底',
  'secure-field': '拒绝操作安全或密码字段',
  'unsafe-element': '无法验证元素所属窗口或安全性',
  'ax-timeout': '应用辅助功能无响应，未确认操作结果，禁止自动重试',
  'ambiguous-selection': '选文匹配不唯一，请用 prefix/suffix 消歧',
  'selection-not-found': '未找到目标文本，请重新获取应用状态',
  'unsupported-os': '此原生功能需要更新的 macOS；基础辅助功能操作支持 macOS 14+',
  'invalid-key': '按键组合无法解析，请修正主按键和修饰键',
  'invalid-action': '原生动作参数无效，请修正后重新观察',
  'invalid-coordinate': '坐标不属于当前观察，请重新观察',
  'target-gone': '目标窗口已失效，请重新观察',
  'not-frontmost': '目标不属于当前前台应用，请重新观察',
  'unknown-application': '无法确认应用身份，请重新选择应用',
  'ambiguous-window': '窗口无法唯一匹配，请重新观察',
  'ambiguous-target': '目标无法唯一匹配，请重新观察',
  'occluded': '目标窗口被遮挡，请重新观察',
  'desktop-not-ready': '目标尚未稳定，动作未投递，请重新观察',
  'unscoped-surface': '附属界面不属于已验证目标，请重新观察',
  'selection-budget': '选文匹配超过预算，请缩小范围',
  'screen-capture-required': '像素坐标操作需要屏幕录制权限',
  'listen-denied': '缺少输入监听权限',
  'listen-disabled': '输入监听已失活',
  'listen-timeout': '输入监听超时，不能判断动作是否已投递',
  'invalid-lease': '原生租约无效，电脑操作已暂停',
  'launch-unknown': '应用启动结果未知，禁止自动重试',
  'app-open-failed': '应用启动结果无法确认，禁止自动重试',
  'focus-unknown': '窗口聚焦结果无法确认，禁止自动重试',
  'ax-write-unknown': '辅助功能写操作结果无法确认，禁止自动重试',
  'post-action-not-settled': '动作已投递但桌面未稳定，禁止自动重试',
}
const STOP_REASONS = new Set([
  '检测到用户操作，桌面控制已暂停', '紧急停止快捷键', '用户点击独立原生停止按钮',
  '安全监听已失活', '安全监听失活', '本地停止UI无响应', '独立原生停止按钮不可见',
  '系统安全输入已开启', '授权已过期', '父进程已退出', '父进程请求停止',
  '动作可能部分执行，已暂停，禁止自动重试',
])
interface NativeErrorDetails { message?: string; code?: string; outcome?: string; permission?: ComputerPermission }
const nativeErrorDetails = new WeakMap<ComputerNativeHostError, NativeErrorDetails>()
export class ComputerNativeHostError extends Error {
  constructor(readonly code: string, readonly reason: string, details?: NativeErrorDetails) {
    super(reason); this.name = 'ComputerNativeHostError'
    if (details) nativeErrorDetails.set(this, details)
  }
}
/** 原生原文仅供受隐私策略约束的内部日志使用，不暴露给用户或序列化错误。 */
export function getNativeErrorDetails(error: ComputerNativeHostError): NativeErrorDetails | undefined {
  return nativeErrorDetails.get(error)
}
/** 只接受已知错误码/权限；原生错误原文留在进程内诊断字段中。 */
export function createComputerNativeHostError(detail: Record<string, unknown>, outcome?: string): ComputerNativeHostError {
  const code = typeof detail.code === 'string' && Object.hasOwn(NATIVE_REASONS, detail.code) ? detail.code : 'native-failure'
  const permission = ['accessibility', 'screen', 'listen', 'post'].includes(String(detail.permission)) ? detail.permission as ComputerPermission : undefined
  return new ComputerNativeHostError(code, NATIVE_REASONS[code] ?? '原生操作未完成；请检查权限和目标上下文', {
    message: typeof detail.message === 'string' ? detail.message : undefined,
    code: typeof detail.code === 'string' ? detail.code : undefined, outcome, permission,
  })
}
/** 私有 stdio 通道：不暴露任意可执行路径给 renderer/模型，不记录观察 payload。 */
export class ComputerNativeHost implements ComputerHost {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, Pending>()
  private stopping?: Promise<void>
  private listeners = new Set<(reason?: string) => void>()
  constructor(private readonly command: () => ComputerHostCommand, private readonly options: { maxLineBytes?: number; loggerEnvironment?: () => { logPath: string; version: string } } = {}) {}
  onStopped(listener: (reason?: string) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private start(): ChildProcessWithoutNullStreams {
    if (this.stopping) throw new Error('原生 helper 正在停止')
    if (this.child) return this.child
    const { executable, args } = this.command()
    let loggerEnvironment: { logPath: string; version: string } | undefined
    try { loggerEnvironment = this.options.loggerEnvironment?.() } catch { /* 日志配置失败不能阻止原生操作。 */ }
    const child = spawn(executable, args ?? [], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, LANG: 'en_US.UTF-8', GAMMA_COMPUTER_LOG_PATH: loggerEnvironment?.logPath, GAMMA_APP_VERSION: loggerEnvironment?.version } })
    this.child = child
    const decoder = new StringDecoder('utf8')
    let buffered = ''
    let failed = false
    const fail = (reason = '原生 helper 失联；不能推断操作未执行'): void => {
      if (failed || this.child !== child) return
      failed = true
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('原生 helper 失联；不能推断操作未执行')) }
      this.pending.clear()
      // 父进程主动回收时，stopped/close 只是退出证明，不应再次触发暂停撤权。
      if (!this.stopping) for (const listener of this.listeners) { try { listener(reason) } catch { /* 不阻塞安全回收。 */ } }
    }
    child.on('error', () => { fail(); void this.terminate().catch(() => {}) })
    child.on('close', () => { fail(); if (this.child === child) this.child = undefined })
    child.stdin.on('error', () => { fail(); void this.terminate().catch(() => {}) })
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
          if (message.event === 'stopped') {
            const reason = typeof message.reason === 'string' && STOP_REASONS.has(message.reason) ? message.reason : '原生桌面控制已暂停'
            fail(reason)
            void this.terminate().catch(() => {})
            continue
          }
          if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') throw new Error()
          const item = this.pending.get(message.id)
          if (!item) continue // 超时/撤权后的迟到回包没有复活能力。
          clearTimeout(item.timer)
          this.pending.delete(message.id)
          if (message.ok) item.resolve(message.result)
          else {
            const detail = message.error && typeof message.error === 'object' && !Array.isArray(message.error) ? message.error as Record<string, unknown> : undefined
            item.reject(createComputerNativeHostError(detail ?? {}))
          }
        } catch { fail(); child.kill('SIGKILL'); return }
      }
    })
    return child
  }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    if (!['status', 'requestPermission', 'resolveApp', 'select', 'observe', 'screenshot', 'listWindows', 'listApps', 'prepare', 'confirmation', 'perform', 'previewFrame'].includes(method)) return Promise.reject(new Error('未允许的原生方法'))
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
