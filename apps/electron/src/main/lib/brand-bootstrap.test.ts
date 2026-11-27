import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entrypoint = join(import.meta.dir, '..', 'index.ts')

test.each(['fresh', 'existing', 'legacy-running', 'proma-running', 'carpus-running', 'development'])('Given %s When Carpus 启动 Then 仅使用自身目录和实例锁', async (scenario) => {
  const root = mkdtempSync(join(tmpdir(), 'carpus-bootstrap-test-'))
  const script = join(root, 'verify.ts')
  writeFileSync(script, `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    import * as originalOS from 'node:os'
    import { createRequire } from 'node:module'
    const root = ${JSON.stringify(root)}
    const scenario = ${JSON.stringify(scenario)}
    const home = join(root, 'home'), appData = join(root, 'appData')
    const config = join(home, scenario === 'development' ? '.carpus-dev' : '.carpus')
    const profile = join(appData, scenario === 'development' ? '@carpus/electron-dev-test' : 'Carpus')
    for (const path of [home, appData]) mkdirSync(path)
    const sentinels = new Map()
    function preserve(directory, file, value) {
      mkdirSync(directory, { recursive: true })
      const path = join(directory, file)
      writeFileSync(path, value)
      sentinels.set(path, value)
    }
    if (scenario === 'legacy-running') {
      preserve(join(home, '.gamma'), 'settings.json', 'Gamma')
      preserve(join(appData, 'Gamma'), 'Local State', 'Gamma profile')
    }
    if (scenario === 'legacy-running' || scenario === 'proma-running') {
      preserve(join(home, '.proma'), 'settings.json', 'Proma')
      preserve(join(appData, '@proma', 'electron'), 'Local State', 'Proma profile')
      preserve(profile, 'carpus-brand-migration.json', '{"status":"profile-pending"}')
    }
    if (scenario === 'existing') preserve(config, 'settings.json', '{"name":"existing"}')
    let name = '@carpus/electron'
    const paths = { appData }
    const events = []
    const app = {
      isPackaged: scenario !== 'development', getPath: (key) => paths[key],
      setPath: (key, value) => { assert.equal(value, profile); assert.ok(existsSync(value)); paths[key] = value },
      setName: (value) => { name = value },
      requestSingleInstanceLock: () => { assert.equal(paths.userData, profile); events.push('lock'); return scenario !== 'carpus-running' },
      whenReady: async () => { events.push('ready') },
      commandLine: { appendSwitch: () => {} }, quit: () => events.push('quit'),
    }
    mock.module('node:os', () => ({ ...originalOS, homedir: () => home }))
    const require = createRequire(${JSON.stringify(entrypoint)})
    mock.module(require.resolve('electron'), () => ({ app, dialog: {}, protocol: { registerSchemesAsPrivileged: () => events.push('protocol') }, session: {}, systemPreferences: {} }))
    mock.module(${JSON.stringify(join(import.meta.dir, '..', 'application.ts'))}, () => {
      assert.ok(existsSync(config))
      events.push('application')
      return {}
    })
    await import(${JSON.stringify(entrypoint)})
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(name, scenario === 'development' ? 'Carpus-test' : 'Carpus')
    assert.equal(paths.userData, profile)
    assert.equal(paths.sessionData, profile)
    assert.deepEqual(events, scenario === 'carpus-running' ? ['lock', 'quit'] : ['lock', 'protocol', 'ready', 'application'])
    assert.equal(existsSync(config), scenario !== 'carpus-running')
    for (const [path, value] of sentinels) assert.equal(readFileSync(path, 'utf8'), value)
    if (scenario !== 'existing') assert.equal(existsSync(join(config, 'settings.json')), false, '不复制旧配置')
  `)
  try {
    const child = Bun.spawn([process.execPath, script], {
      env: { ...process.env, CARPUS_DEV: '', GAMMA_DEV: '', CARPUS_DEV_INSTANCE: 'test' },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(status, scenario + '\n' + stdout + '\n' + stderr).toBe(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
