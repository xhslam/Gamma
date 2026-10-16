import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildResources } from './build-resources'

const directories: string[] = []
function createApp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gamma resources 中文 '))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Given macOS 与 Windows 共用的资源构建步骤', () => {
  test('When 路径含空格和中文 Then 复制资源目录内容且保留主进程产物', () => {
    const app = createApp()
    mkdirSync(join(app, 'resources', '嵌套 目录'), { recursive: true })
    mkdirSync(join(app, 'dist'))
    writeFileSync(join(app, 'resources', '嵌套 目录', 'icon.png'), 'resource')
    writeFileSync(join(app, 'dist', 'main.cjs'), 'main')
    buildResources(app)
    expect(readFileSync(join(app, 'dist', 'resources', '嵌套 目录', 'icon.png'), 'utf8')).toBe('resource')
    expect(readFileSync(join(app, 'dist', 'main.cjs'), 'utf8')).toBe('main')
    expect(existsSync(join(app, 'dist', 'resources', 'resources'))).toBe(false)
  })

  test('When 重复构建 Then 使用新版资源覆盖旧版而不增加目录层级', () => {
    const app = createApp()
    mkdirSync(join(app, 'resources'))
    writeFileSync(join(app, 'resources', 'icon.png'), 'old')
    buildResources(app)
    writeFileSync(join(app, 'resources', 'icon.png'), 'new')
    buildResources(app)
    expect(readFileSync(join(app, 'dist', 'resources', 'icon.png'), 'utf8')).toBe('new')
    expect(existsSync(join(app, 'dist', 'resources', 'resources'))).toBe(false)
  })

  test('When 资源目录缺失 Then 直接报告失败而不是继续打包', () => {
    expect(() => buildResources(createApp())).toThrow()
  })

  test('When 构建入口无法复制资源 Then 进程以非零状态退出', async () => {
    const app = createApp()
    // 用临时入口调用同一个实现，避免触碰项目真实 resources。
    const entry = join(app, 'entry.ts')
    writeFileSync(entry, `import { buildResources } from ${JSON.stringify(resolve(import.meta.dir, 'build-resources.ts'))}; buildResources(${JSON.stringify(app)});`)
    const child = Bun.spawn([process.execPath, entry], { stdout: 'ignore', stderr: 'ignore' })
    expect(await child.exited).not.toBe(0)
  })
})
