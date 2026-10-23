import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getElectronExecutablePath, getIsolatedElectronTestArguments } from './electron-executable'

describe('Given Electron GUI 回归的钥匙串隔离', () => {
  test('When 入口和参数含空格 Then 隔离开关在入口前且参数保持完整', () => {
    expect(getIsolatedElectronTestArguments('/tmp/path with spaces/main.cjs', '/tmp/test profile')).toEqual([
      '--use-mock-keychain', '/tmp/path with spaces/main.cjs', '/tmp/test profile',
    ])
  })

  test.skipIf(process.platform !== 'darwin')('When 真实Electron连续启动并加解密 Then 内存钥匙串可用且无需用户授权', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gamma-keychain-isolation-'))
    const entryPoint = join(directory, 'main.cjs')
    try {
      await writeFile(entryPoint, `
const { app, safeStorage, BrowserWindow, session } = require('electron');
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  let window;
  try {
    if (!app.commandLine.hasSwitch('use-mock-keychain')) throw new Error('启动前未隔离钥匙串');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('隔离钥匙串不可用');
    const plain = 'synthetic-test-credential';
    if (safeStorage.decryptString(safeStorage.encryptString(plain)) !== plain) throw new Error('加解密不一致');
    window = new BrowserWindow({ show: false });
    await window.loadURL('data:text/html,<title>isolated</title>');
    await session.defaultSession.cookies.set({ url: 'https://isolated.test', name: 'synthetic', value: 'fixture', expirationDate: Date.now() / 1000 + 600 });
    await session.defaultSession.cookies.flushStore();
    console.log('GAMMA_KEYCHAIN_ISOLATED_OK');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window?.destroy(); app.quit(); }
});
`)
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      for (let attempt = 0; attempt < 2; attempt++) {
        const child = Bun.spawn([getElectronExecutablePath(), ...getIsolatedElectronTestArguments(entryPoint)], {
          env: environment, stdout: 'pipe', stderr: 'pipe',
        })
        const timeout = setTimeout(() => child.kill(), 12_000)
        try {
          const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
          ])
          expect(code, stderr).toBe(0)
          expect(stdout).toContain('GAMMA_KEYCHAIN_ISOLATED_OK')
          expect(stderr).not.toMatch(/Keychain (?:lookup|add) failed/)
        } finally { clearTimeout(timeout) }
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)
})
