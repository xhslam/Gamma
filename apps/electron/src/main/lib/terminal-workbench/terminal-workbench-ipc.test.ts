import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'
import { TERMINAL_WORKBENCH_IPC_CHANNELS } from '@gamma/shared'

describe('终端工作台 IPC 的 CommonJS 产物', () => {
  test('打包后的模块能注册 IPC，并在新用户目录返回空会话列表', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamma-terminal-ipc-'))
    try {
      const { outputFiles: [bundle] } = buildSync({
        entryPoints: [join(import.meta.dir, 'terminal-workbench-ipc.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron', 'node-pty'],
        logLevel: 'silent',
        write: false,
      })
      const filename = join(directory, 'main.cjs')
      const requireModule = createRequire(filename)
      const handlers = new Map<string, () => Promise<unknown>>()
      const electron = {
        app: { getPath: () => directory },
        ipcMain: { handle: (channel: string, handler: () => Promise<unknown>) => handlers.set(channel, handler) },
      }
      const module = { exports: {} as typeof import('./terminal-workbench-ipc') }
      runInNewContext(bundle!.text, {
        module,
        require: (id: string) => id === 'electron' ? electron : requireModule(id),
        __filename: filename,
        __dirname: directory,
        process,
        console,
      }, { filename })

      module.exports.registerTerminalWorkbenchIpc({ mainWindow: () => null })
      expect(await handlers.get(TERMINAL_WORKBENCH_IPC_CHANNELS.PROJECTS_LIST)!()).toEqual([])
      expect(await handlers.get(TERMINAL_WORKBENCH_IPC_CHANNELS.LIST)!()).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
