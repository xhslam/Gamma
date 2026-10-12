import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigDir, resolveDefaultConfigDir } from './paths'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'gamma-cli-paths-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Given Gamma CLI 解析会话目录', () => {
  it('When 首次使用没有旧数据 Then 返回新目录且不创建数据', () => {
    const root = fixture()
    expect(resolveDefaultConfigDir(root)).toBe(join(root, '.gamma'))
    expect(existsSync(join(root, '.gamma'))).toBe(false)
  })
  it('When 桌面端尚未迁移 Then 只读原有 Proma 目录', () => {
    const root = fixture()
    mkdirSync(join(root, '.proma'))
    expect(resolveDefaultConfigDir(root)).toBe(join(root, '.proma'))
    expect(existsSync(join(root, '.gamma'))).toBe(false)
  })
  it('When 新旧目录同时存在 Then 优先使用 Gamma 且开发数据独立', () => {
    const root = fixture()
    for (const name of ['.proma', '.gamma', '.proma-dev']) mkdirSync(join(root, name))
    expect(resolveDefaultConfigDir(root)).toBe(join(root, '.gamma'))
    expect(resolveDefaultConfigDir(root, true)).toBe(join(root, '.proma-dev'))
    mkdirSync(join(root, '.gamma-dev'))
    expect(resolveDefaultConfigDir(root, true)).toBe(join(root, '.gamma-dev'))
  })
  it('When 显式指定目录 Then 保留用户选定路径', () => {
    const root = fixture()
    expect(resolveConfigDir({ configDir: root, dev: true })).toBe(root)
  })
})
