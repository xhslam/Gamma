import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Given 新用户、旧 profile 或运行中的 Proma When bootstrap 初始化 Then ready 前隔离路径且不提前加载业务模块', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gamma-bootstrap-test-'))
  const script = join(root, 'verify.ts')
  writeFileSync(script, [
    "import { mock } from 'bun:test'",
    "import assert from 'node:assert/strict'",
    "import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "import * as originalOS from 'node:os'",
    "import { createRequire } from 'node:module'",
    'const root = mkdtempSync(join(' + JSON.stringify(root) + ", 'case-'))",
    'const scenario = process.argv[2]',
    "const home = join(root, 'home'), appData = join(root, 'appData'), temp = join(root, 'temp')",
    'for (const path of [home, appData, temp]) mkdirSync(path)',
    "const oldProfile = join(appData, '@proma/electron')",
    "if (scenario !== 'fresh') {",
    '  mkdirSync(oldProfile, { recursive: true })',
    "  mkdirSync(join(home, '.proma'))",
    "  writeFileSync(join(home, '.proma', 'settings.json'), JSON.stringify({ name: '用户原文 Proma' }))",
    "  writeFileSync(join(oldProfile, 'Local State'), '{}')",
    '}',
    "let name = '@gamma/electron'",
    "const paths = { appData, temp, userData: join(root, 'not-created'), sessionData: join(root, 'not-created') }",
    'const events = [], listeners = new Map()',
    'const app = {',
    '  isPackaged: true, getPath: (key) => paths[key],',
    "  setPath: (key, value) => { assert.ok(existsSync(value), 'setPath 必须使用已有目录'); paths[key] = value },",
    '  setName: (value) => { name = value },',
    "  requestSingleInstanceLock: () => { events.push('lock:' + paths.userData); return !(scenario === 'busy' && paths.userData === oldProfile) },",
    "  releaseSingleInstanceLock: () => events.push('release'),",
    '  whenReady: () => new Promise(() => {}), on: (event, listener) => listeners.set(event, listener),',
    "  commandLine: { appendSwitch: () => {} }, quit: () => events.push('quit')",
    '}',
    "mock.module('node:os', () => ({ ...originalOS, homedir: () => home, tmpdir: () => temp }))",
    'const electronPath = createRequire(' + JSON.stringify(join(import.meta.dir, '..', 'index.ts')) + ").resolve('electron')",
    "mock.module(electronPath, () => ({ app, dialog: {}, protocol: { registerSchemesAsPrivileged: () => events.push('protocol') }, safeStorage: {}, session: {} }))",
    'await import(' + JSON.stringify(join(import.meta.dir, '..', 'index.ts')) + ')',
    "assert.equal(existsSync(join(home, '.gamma')), false, '业务服务不能提前创建配置')",
    "if (scenario === 'busy') {",
    '  assert.ok(paths.userData.startsWith(temp))',
    "  assert.equal(events.includes('protocol'), false)",
    "  assert.equal(events.includes('release'), false)",
    "  assert.equal(existsSync(join(appData, 'Gamma')), false)",
    '} else {',
    "  assert.equal(name, 'Gamma')",
    "  assert.equal(paths.userData, join(appData, 'Gamma'))",
    '  assert.equal(paths.sessionData, paths.userData)',
    "  assert.ok(events.includes('protocol'))",
    "  if (scenario === 'legacy') {",
    "    assert.ok(events.indexOf('lock:' + oldProfile) < events.indexOf('release'))",
    "    assert.ok(events.indexOf('release') < events.indexOf('lock:' + paths.userData))",
    "    assert.equal(JSON.parse(readFileSync(join(home, '.proma', 'settings.json'), 'utf8')).name, '用户原文 Proma')",
    "    assert.equal(JSON.parse(readFileSync(join(paths.userData, 'gamma-brand-migration.json'), 'utf8')).status, 'profile-pending')",
    '  }',
    '}',
    "listeners.get('will-quit')?.()",
    'rmSync(root, { recursive: true, force: true })',
  ].join('\n'))
  try {
    for (const scenario of ['fresh', 'legacy', 'busy']) {
      const child = Bun.spawn([process.execPath, script, scenario], { stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(status, scenario + '\n' + stdout + '\n' + stderr).toBe(0)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
