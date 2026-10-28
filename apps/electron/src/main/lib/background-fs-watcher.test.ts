import { describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { BACKGROUND_WATCH_SOURCE, BackgroundFSWatcher, watchInBackground } from './background-fs-watcher'

describe('Given 工作区文件监听初始化不能阻塞主界面', () => {
  test('When 监听真实子目录变化 Then 异步返回相对路径并保留递归监听', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-background-watch-'))
    mkdirSync(join(root, 'nested'))
    const watcher = watchInBackground(root, { recursive: true }, () => {})
    try {
      await once(watcher, 'ready', { signal: AbortSignal.timeout(3000) })
      const changed = once(watcher, 'change', { signal: AbortSignal.timeout(3000) })
      writeFileSync(join(root, 'nested', 'probe.txt'), '测试')
      const [eventType, filename] = await changed
      expect(['change', 'rename']).toContain(eventType)
      expect(String(filename).replaceAll('\\', '/')).toBe('nested/probe.txt')
    } finally { watcher.close(); rmSync(root, { recursive: true, force: true }) }
  })

  test('When 目录不存在 Then 原生错误码异步通知现有自愈路径', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-background-watch-'))
    const watcher = watchInBackground(join(root, 'missing'), { recursive: true }, () => {})
    try {
      const [error] = await once(watcher, 'error', { signal: AbortSignal.timeout(3000) }) as [NodeJS.ErrnoException]
      expect(error.code).toBe('ENOENT')
    } finally { watcher.close(); rmSync(root, { recursive: true, force: true }) }
  })

  test('When 底层初始化等待授权 Then 主线程仍能运行且关闭只通知一次', async () => {
    const latch = new SharedArrayBuffer(4)
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      Atomics.wait(new Int32Array(workerData.latch), 0, 0);
      ${BACKGROUND_WATCH_SOURCE.replace("const { parentPort, workerData }", "const { parentPort }")}
    `, { eval: true, workerData: { latch, path: tmpdir(), options: {} } })
    const watcher = new BackgroundFSWatcher(worker)
    let ready = false
    let closes = 0
    watcher.on('ready', () => { ready = true })
    watcher.on('close', () => { closes++ })
    watcher.on('error', () => {})
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      expect(ready).toBe(false)
      const started = once(watcher, 'ready', { signal: AbortSignal.timeout(3000) })
      Atomics.store(new Int32Array(latch), 0, 1)
      Atomics.notify(new Int32Array(latch), 0)
      await started
      expect(ready).toBe(true)
      watcher.close()
      watcher.close()
      expect(closes).toBe(1)
    } finally { watcher.close() }
  })
})
