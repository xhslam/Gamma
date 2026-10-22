import { expect, test } from 'bun:test'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getElectronExecutablePath } from '../../test-utils/electron-executable'

test('Given 真实 Electron CDP When 输入/遮挡/验证/iframe 回归 Then 所有场景通过', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gamma-browser-computer-'))
  try {
    const runner = join(directory, 'runner.cjs')
    await build({
      entryPoints: [resolve(import.meta.dir, '../../test-utils/fixtures/browser-computer-regression.ts')],
      outfile: runner, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      plugins: [{ name: 'isolated-preferences', setup(builder) {
        builder.onLoad({ filter: /\/settings-service\.ts$/ }, () => ({ contents: 'export const getSettings = () => ({ browserRiskDisclaimerVersion: 999 })', loader: 'ts' }))
      } }],
    })
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
    const child = Bun.spawn([getElectronExecutablePath(), runner, directory], { stdout: 'pipe', stderr: 'pipe', env: environment })
    const timeout = setTimeout(() => child.kill(), 40_000)
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split('\n').find(row => row.startsWith('GAMMA_BROWSER_RESULT:'))
      if (!line) throw new Error(`Electron 未返回结果 (${code})：${stderr.slice(-3000)}`)
      const result = JSON.parse(line.slice('GAMMA_BROWSER_RESULT:'.length)) as { checks: string[]; error?: string }
      if (result.error) throw new Error(`${result.checks.length} 个场景已通过；${result.error}`)
      expect(code).toBe(0)
      expect(result.checks.length).toBe(13)
    } finally { clearTimeout(timeout) }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60_000)
