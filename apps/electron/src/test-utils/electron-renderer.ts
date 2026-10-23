import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import tailwindcss from 'tailwindcss'
import loadTailwindConfig from 'tailwindcss/loadConfig'
import { getIsolatedElectronTestArguments } from './electron-executable'

export interface ElectronRendererHarness {
  run<T>(scenario: string, reloadScenario?: string): Promise<T>
  dispose(): Promise<void>
}

interface ElectronRendererHarnessOptions {
  /** 测试专用主进程初始化，可注册真实 ipcMain handler，不能连接用户配置。 */
  mainProcessSetup?: string
  preloadSource?: string
  /** 真实服务合成配置的隔离环境，仅影响本次Electron子进程。 */
  environment?: Record<string, string>
  mainProcessReady?: string
  mainWindowSetup?: string
  timeoutMs?: number
}

/** 用应用真实的 Vite 构建与 Chromium DOM 检查 renderer，避免模拟 DOM 掩盖 xterm 原生事件顺序。 */
export async function createElectronRendererHarness(entrySource: string, options: ElectronRendererHarnessOptions = {}): Promise<ElectronRendererHarness> {
  const directory = await mkdtemp(join(tmpdir(), 'gamma-renderer-regression-'))
  const entry = 'gamma-electron-renderer-regression'
  try {
    const tailwindConfig = loadTailwindConfig(resolve(import.meta.dir, '../../tailwind.config.js'))
    const result = await build({
      configFile: resolve(import.meta.dir, '../../vite.config.ts'),
      logLevel: 'silent',
      // Bun 从 monorepo 根执行时，也必须使用应用的 token、主题 safelist 与绝对扫描范围。
      css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: [resolve(import.meta.dir, '../renderer/**/*.{js,ts,jsx,tsx}')] })] } },
      plugins: [{
        name: 'electron-renderer-regression-entry',
        resolveId: (id) => id === entry ? `\0${entry}` : undefined,
        load: (id) => id === `\0${entry}` ? entrySource : undefined,
      }],
      build: {
        write: false,
        minify: 'esbuild',
        modulePreload: false,
        cssCodeSplit: false,
        rollupOptions: { input: entry, output: { format: 'iife', inlineDynamicImports: true } },
      },
    })
    const output = (Array.isArray(result) ? result : [result]).flatMap((item) => 'output' in item ? item.output : [])
    const chunk = output.find((item) => item.type === 'chunk' && item.isEntry)
    if (!chunk || chunk.type !== 'chunk') throw new Error('Renderer 回归构建没有生成可执行入口')
    const css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
      .map((item) => item.type === 'asset' ? typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source) : '')
      .join('\n')
    await Promise.all([
      ...(options.preloadSource ? [writeFile(join(directory, 'preload.cjs'), options.preloadSource)] : []),
      writeFile(join(directory, 'renderer.js'), chunk.code),
      writeFile(join(directory, 'renderer.css'), css),
      writeFile(join(directory, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>'),
    ])
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }

  const { getElectronExecutablePath } = await import('./electron-executable')
  const electronExecutable = getElectronExecutablePath()
  let runId = 0
  return {
    async run<T>(scenario: string, reloadScenario?: string): Promise<T> {
      const mainPath = join(directory, `main-${++runId}.cjs`)
      const marker = 'GAMMA_RENDERER_RESULT:'
      // 不连接真实 PTY/剪贴板；结果只来自该次场景提供的 mock 数据。
      await writeFile(mainPath, `
const { app, BrowserWindow } = require('electron');
${options.mainProcessSetup ?? ''}
app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  ${options.mainProcessReady ?? ''}
  const window = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, ${options.preloadSource ? `preload: ${JSON.stringify(join(directory, 'preload.cjs'))}` : ''} } });
  ${options.mainWindowSetup ?? ''}
  try {
    await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    let result = await window.webContents.executeJavaScript(${JSON.stringify(`(async () => { ${scenario} })()`)});
    ${reloadScenario ? `await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
    result = { before: result, after: await window.webContents.executeJavaScript(${JSON.stringify(`(async () => { ${reloadScenario} })()`)}) };` : ''}
    process.stdout.write(${JSON.stringify(marker)} + JSON.stringify({ result }) + '\\n');
  } catch (error) {
    process.stdout.write(${JSON.stringify(marker)} + JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }) + '\\n');
    process.exitCode = 1;
  } finally { window.destroy(); app.quit(); }
});
`)
      const environment = { ...process.env, ...options.environment }
      // 父进程可能设置该变量，Electron GUI runner 必须使用 Chromium 而非 Node 模式。
      delete environment.ELECTRON_RUN_AS_NODE
      const child = Bun.spawn([electronExecutable, ...getIsolatedElectronTestArguments(mainPath)], { stdout: 'pipe', stderr: 'pipe', env: environment })
      const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 15_000)
      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        const line = stdout.split('\n').find((value) => value.startsWith(marker))
        if (!line) throw new Error(`Electron renderer 没有返回测试结果（退出码 ${exitCode}）：${stderr.slice(-2_000)}`)
        const message = JSON.parse(line.slice(marker.length)) as { result?: T; error?: string }
        if (message.error) throw new Error(message.error)
        if (exitCode !== 0) throw new Error(`Electron renderer 异常退出：${exitCode}`)
        return message.result as T
      } finally { clearTimeout(timeout) }
    },
    dispose: () => rm(directory, { recursive: true, force: true }),
  }
}
