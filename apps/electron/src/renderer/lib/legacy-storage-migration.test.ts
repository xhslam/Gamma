import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateLegacyRendererStorage } from './legacy-storage-migration'
import type { LegacyStorageMigrationTarget } from './legacy-storage-migration'

class TestStorage implements LegacyStorageMigrationTarget {
  readonly values = new Map<string, string>()
  rejectedKeys = new Set<string>()

  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) this.values.set(key, value)
  }

  get length(): number { return this.values.size }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void {
    if (this.rejectedKeys.has(key)) throw new Error('配额不足')
    this.values.set(key, value)
  }
}

describe('Gamma 渲染层旧缓存迁移', () => {
  test('Given 改名前的浅色主题 When 入口先加载迁移依赖再初始化真实 Jotai atom Then 首次 atom 读取继承旧主题', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'gamma-renderer-bootstrap-'))
    try {
      const entryPath = join(fixtureDir, 'bootstrap.ts')
      const migrationPath = fileURLToPath(new URL('./legacy-storage-migration.ts', import.meta.url))
      const themePath = fileURLToPath(new URL('../atoms/theme.ts', import.meta.url))
      writeFileSync(entryPath, `import ${JSON.stringify(migrationPath)}\nimport { themeModeAtom, themeStyleAtom } from ${JSON.stringify(themePath)}\nconsole.log(JSON.stringify([themeModeAtom.init, themeStyleAtom.init]))\n`)
      const result = Bun.spawnSync([process.execPath, '--eval', `
        const values = new Map([['proma-theme-mode', 'light'], ['proma-theme-style', 'ocean-light']]);
        const storage = {
          get length() { return values.size; },
          key(index) { return [...values.keys()][index] ?? null; },
          getItem(key) { return values.get(key) ?? null; },
          setItem(key, value) { values.set(key, value); }
        };
        globalThis.window = { localStorage: storage };
        globalThis.localStorage = storage;
        await import(${JSON.stringify(entryPath)});
      `])
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString().trim()).toBe('["light","ocean-light"]')
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  test('Given 旧模型、主题和会话布局缓存 When 改名后初始化 Then 新键继承原始值且旧键保留', () => {
    const storage = new TestStorage({
      'proma-selected-model': '{"channelId":"channel-1","modelId":"model-1"}',
      'proma-theme-mode': 'light',
      'proma-agent-side-panel-layout-map': '{"session-1":{"tabs":["files"]}}',
      'other-app-preference': 'unchanged',
    })

    migrateLegacyRendererStorage(storage)

    expect(storage.getItem('gamma-selected-model')).toBe(storage.getItem('proma-selected-model'))
    expect(storage.getItem('gamma-theme-mode')).toBe('light')
    expect(storage.getItem('gamma-agent-side-panel-layout-map')).toBe(storage.getItem('proma-agent-side-panel-layout-map'))
    expect(storage.getItem('other-app-preference')).toBe('unchanged')
    expect(storage.getItem('proma-theme-mode')).toBe('light')
  })

  test('Given 新键已有选择或空值 When 多次迁移 Then 新选择优先且迁移幂等', () => {
    const storage = new TestStorage({
      'proma-theme-mode': 'light', 'gamma-theme-mode': 'dark',
      'proma-selected-prompt': 'old-prompt', 'gamma-selected-prompt': '',
    })

    migrateLegacyRendererStorage(storage)
    const firstValues = [...storage.values]
    migrateLegacyRendererStorage(storage)

    expect(storage.getItem('gamma-theme-mode')).toBe('dark')
    expect(storage.getItem('gamma-selected-prompt')).toBe('')
    expect([...storage.values]).toEqual(firstValues)
  })

  test('Given 单个键写入被拒绝 When 迁移 Then 保留旧数据并继续恢复其他键', () => {
    const storage = new TestStorage({ 'proma-app-mode': 'chat', 'proma-theme-mode': 'light' })
    storage.rejectedKeys.add('gamma-app-mode')

    expect(() => migrateLegacyRendererStorage(storage)).not.toThrow()
    expect(storage.getItem('gamma-app-mode')).toBeNull()
    expect(storage.getItem('proma-app-mode')).toBe('chat')
    expect(storage.getItem('gamma-theme-mode')).toBe('light')
  })

  test('Given 浏览器禁止枚举缓存 When 初始化 Then 不阻止应用启动', () => {
    const storage: LegacyStorageMigrationTarget = {
      get length(): number { throw new Error('存储不可用') },
      key: () => null,
      getItem: () => null,
      setItem: () => { throw new Error('不应写入') },
    }

    expect(() => migrateLegacyRendererStorage(storage)).not.toThrow()
  })
})
