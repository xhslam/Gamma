import { beforeAll, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { Terminal } from '@xterm/xterm'
import { build } from 'vite'

interface TerminalModule {
  Terminal: new () => Terminal
}

let bundle: string

beforeAll(async () => {
  const entry = 'proma-terminal-build-test'
  // 走应用真实的 Vite resolver、tree-shaking 和压缩，不能用 Bun 的 CJS 入口替代。
  const result = await build({
    configFile: resolve(import.meta.dir, '../../vite.config.ts'),
    logLevel: 'silent',
    plugins: [{
      name: 'terminal-build-test-entry',
      resolveId: (id) => id === entry ? `\0${entry}` : undefined,
      load: (id) => id === `\0${entry}` ? "export { Terminal } from '@xterm/xterm'" : undefined,
    }],
    build: {
      write: false,
      minify: 'esbuild',
      modulePreload: false,
      rollupOptions: { input: entry, preserveEntrySignatures: 'strict', output: { format: 'cjs', exports: 'named' } },
    },
  })
  const output = (Array.isArray(result) ? result : [result]).flatMap((item) => 'output' in item ? item.output : [])
  const chunk = output.find((item) => item.type === 'chunk' && item.isEntry)
  if (!chunk || chunk.type !== 'chunk') throw new Error('终端生产构建没有生成可执行入口')
  bundle = chunk.code
}, 10_000)

function createTerminal() {
  const module = { exports: {} as TerminalModule }
  let rejectWrite: ((error: unknown) => void) | undefined
  runInNewContext(bundle, {
    module,
    exports: module.exports,
    console,
    process: { title: 'terminal-build-test' },
    navigator: { platform: 'MacIntel', userAgent: 'Terminal regression test', language: 'zh-CN' },
    document: { createElement: () => ({ style: {}, getContext: () => null }) },
    queueMicrotask,
    performance,
    clearTimeout,
    setTimeout: (callback: () => void, delay: number) => setTimeout(() => {
      // xterm 异步解析异常必须让测试失败，不能只等待 write callback 超时。
      try { callback() } catch (error) { rejectWrite?.(error) }
    }, delay),
  })
  const terminal = new module.exports.Terminal()
  const replies: string[] = []
  terminal.onData((data) => replies.push(data))
  const write = (data: string) => new Promise<void>((resolveWrite, reject) => {
    rejectWrite = reject
    terminal.write(data, resolveWrite)
  })
  return { terminal, replies, write }
}

describe('终端生产构建的真实模式查询解析', () => {
  test('Given agy 查询同步输出模式 When 生产 bundle 解析并继续输出 Then 返回模式状态且完成后续批次', async () => {
    const { terminal, replies, write } = createTerminal()
    try {
      await write('\x1b[?2026$p')
      await write('\x1b[?2026h\x1b[?2026$p\x1b[?2026l\r\nAGY_READY')
      expect(replies).toEqual(['\x1b[?2026;2$y', '\x1b[?2026;1$y'])
      expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe('AGY_READY')
    } finally { terminal.dispose() }
  })

  test('Given ANSI 模式及未知私有模式查询 When 生产 bundle 解析 Then 返回支持状态并继续显示提示符', async () => {
    const { terminal, replies, write } = createTerminal()
    try {
      await write('\x1b[4$p\x1b[?2027$p\x1b[?9999$p\r\nSHELL_READY')
      expect(replies).toEqual(['\x1b[4;2$y', '\x1b[?2027;0$y', '\x1b[?9999;0$y'])
      expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe('SHELL_READY')
    } finally { terminal.dispose() }
  })
})
