import { EventEmitter } from 'node:events'
import type { FSWatcher, WatchOptions } from 'node:fs'
import { Worker } from 'node:worker_threads'

// 只使用 Node 内置模块，打包后不依赖额外 worker 文件或应用源码路径。
export const BACKGROUND_WATCH_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { watch } = require('node:fs');
try {
  const watcher = watch(workerData.path, workerData.options, (eventType, filename) => {
    parentPort.postMessage({ type: 'change', eventType, filename: filename == null ? null : String(filename) });
  });
  watcher.on('error', error => {
    parentPort.postMessage({ type: 'error', message: error.message, code: error.code });
    watcher.close();
  });
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error.message, code: error.code });
}
`

/** fs.watch 的初始化也可能等待系统授权；不能在 Electron 主线程上执行。 */
export class BackgroundFSWatcher extends EventEmitter implements FSWatcher {
  private closed = false
  constructor(private readonly worker: Worker) {
    super()
    worker.on('message', (message: unknown) => {
      if (this.closed || !message || typeof message !== 'object' || !('type' in message)) return
      if (message.type === 'ready') this.emit('ready')
      else if (message.type === 'change' && 'eventType' in message && typeof message.eventType === 'string' && 'filename' in message && (message.filename === null || typeof message.filename === 'string')) {
        this.emit('change', message.eventType, message.filename)
      } else if (message.type === 'error' && 'message' in message && typeof message.message === 'string') {
        const error: NodeJS.ErrnoException = new Error(message.message)
        if ('code' in message && typeof message.code === 'string') error.code = message.code
        this.emit('error', error)
      }
    })
    worker.once('error', (error) => { if (!this.closed) this.emit('error', error) })
    worker.once('exit', (code) => {
      if (!this.closed) {
        this.closed = true
        this.emit('error', new Error(`文件监听线程意外退出（${code}）`))
        this.emit('close')
      }
    })
    // 监听器等待权限时也不能阻止整个应用退出。
    worker.unref()
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    void this.worker.terminate().catch(() => { /* 关闭不影响应用退出。 */ })
    this.emit('close')
  }
  ref(): this { this.worker.ref(); return this }
  unref(): this { this.worker.unref(); return this }
}

export function watchInBackground(path: string, options: WatchOptions, listener: (eventType: string, filename: string | null) => void): FSWatcher {
  const watcher = new BackgroundFSWatcher(new Worker(BACKGROUND_WATCH_SOURCE, { eval: true, workerData: { path, options } }))
  watcher.on('change', listener)
  return watcher
}
