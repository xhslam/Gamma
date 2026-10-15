import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import tailwindcss from 'tailwindcss'
import loadTailwindConfig from 'tailwindcss/loadConfig'

export interface VisualRendererOptions {
  dpr?: number
  zoom?: number
  reducedMotion?: boolean
  screenshot?: string
  hoverSelector?: string
  keyboard?: boolean
}

export interface VisualRendererHarness {
  run<T>(scenario: string, options?: VisualRendererOptions): Promise<T>
  dispose(): Promise<void>
}

/** 独立视觉回归宿主：使用真实 Chromium 的 DPR、页面缩放和 reduced-motion 媒体仿真，不改动通用交互测试宿主。 */
export async function createVisualRendererHarness(entrySource: string): Promise<VisualRendererHarness> {
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
      writeFile(join(directory, 'renderer.js'), chunk.code),
      writeFile(join(directory, 'renderer.css'), css),
      writeFile(join(directory, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>'),
    ])
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }

  const require = createRequire(import.meta.url)
  const electronExecutable: string = require('electron')
  let runId = 0
  return {
    async run<T>(scenario: string, options: VisualRendererOptions = {}): Promise<T> {
      const mainPath = join(directory, `main-${++runId}.cjs`)
      const marker = 'GAMMA_RENDERER_RESULT:'
      // 不连接真实 PTY/剪贴板；结果只来自该次场景提供的 mock 数据。
      await writeFile(mainPath, `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', String(${options.dpr ?? 1}));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    window.webContents.setZoomFactor(${options.zoom ?? 1});
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: Math.round(900 / ${options.zoom ?? 1}), height: Math.round(600 / ${options.zoom ?? 1}), deviceScaleFactor: ${options.dpr ?? 1}, mobile: false,
    });
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: ${JSON.stringify(options.reducedMotion ? 'reduce' : 'no-preference')} }],
    });
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    ${options.keyboard ? `await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', windowsVirtualKeyCode: 9 });
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', windowsVirtualKeyCode: 9 });` : ''}
    ${options.hoverSelector ? `const pointer = await window.webContents.executeJavaScript(${JSON.stringify(`(() => { const rect = document.querySelector(${JSON.stringify(options.hoverSelector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + 10 }; })()`)});
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });` : ''}
    const result = await window.webContents.executeJavaScript(${JSON.stringify(`(async () => { ${scenario} })()`)});
    ${options.screenshot ? `require('node:fs').writeFileSync(${JSON.stringify(options.screenshot)}, (await window.webContents.capturePage()).toPNG());` : ''}
    process.stdout.write(${JSON.stringify(marker)} + JSON.stringify({ result }) + '\\n');
  } catch (error) {
    process.stdout.write(${JSON.stringify(marker)} + JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }) + '\\n');
    process.exitCode = 1;
  } finally { window.destroy(); app.quit(); }
});
`)
      const environment = { ...process.env }
      // 父进程可能设置该变量，Electron GUI runner 必须使用 Chromium 而非 Node 模式。
      delete environment.ELECTRON_RUN_AS_NODE
      const child = Bun.spawn([electronExecutable, mainPath], { stdout: 'pipe', stderr: 'pipe', env: environment })
      const timeout = setTimeout(() => child.kill(), 15_000)
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
