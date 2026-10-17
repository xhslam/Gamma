import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

interface ConfigHomeResult { config: string }

/** 子进程不载入测试preload，验证真实配置解析，不使用同一进程的os替身。 */
describe('配置根与启动迁移隔离', () => {
  for (const nodeEnv of ['test', 'production']) {
    test(`Given ${nodeEnv}进程预设GAMMA_TEST_HOME When 解析配置 Then仍仅使用真实HOME`, () => {
      const root = mkdtempSync(join(tmpdir(), 'gamma-config-home-'))
      const home = join(root, 'home')
      const alternate = join(root, 'must-not-be-used')
      try {
        const source = `import { getConfigDir } from ${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))}; console.log(JSON.stringify({ config: getConfigDir() }))`
        const result = spawnSync(process.execPath, ['--eval', source], {
          env: { ...process.env, NODE_ENV: nodeEnv, HOME: home, GAMMA_DEV: '0', GAMMA_TEST_HOME: alternate },
          encoding: 'utf8',
        })
        expect(result.status, result.stderr).toBe(0)
        const output = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as ConfigHomeResult
        expect(output.config).toBe(join(home, '.gamma'))
        expect(existsSync(join(home, '.gamma'))).toBe(true)
        expect(existsSync(alternate)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
  test('Given显式测试配置根 When成对注入及恢复 Then不改变HOME或父预设环境变量', () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-config-injection-'))
    const home = join(root, 'home')
    const injected = join(root, 'injected')
    try {
      const source = `
        import { getConfigDir, setConfigHomeForTest } from ${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))};
        const previous = setConfigHomeForTest(${JSON.stringify(injected)});
        const during = getConfigDir();
        setConfigHomeForTest(previous);
        console.log(JSON.stringify({ during, after: getConfigDir(), preserved: process.env.GAMMA_TEST_HOME === 'parent-sentinel' }));
      `
      const result = spawnSync(process.execPath, ['--eval', source], {
        env: { ...process.env, NODE_ENV: 'test', HOME: home, GAMMA_DEV: '0', GAMMA_TEST_HOME: 'parent-sentinel' }, encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({ during: join(injected, '.gamma'), after: join(home, '.gamma'), preserved: true })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('Given非测试入口 When尝试注入配置根 Then拒绝并保持默认配置', () => {
    const result = spawnSync(process.execPath, ['--eval', `
      import { setConfigHomeForTest } from ${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))};
      try { setConfigHomeForTest('/must-not-be-used'); process.exitCode = 1; }
      catch (error) { console.log(error.message); }
    `], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('仅允许Bun测试入口')
  })
})
