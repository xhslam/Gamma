import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { YAML } from 'bun'
import { resolveUpdateConfigPath } from './update-config'

const directories: string[] = []
function fixture(): { resources: string; userData: string } {
  const root = mkdtempSync(join(tmpdir(), 'gamma-update-config-'))
  directories.push(root)
  const resources = join(root, 'resources'), userData = join(root, 'user-data')
  mkdirSync(resources)
  mkdirSync(userData)
  return { resources, userData }
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('Given 本地目录打包可能缺少更新配置', () => {
  test('When app-update.yml 缺失 Then 在用户目录原子生成完整正式配置，不修改应用资源', () => {
    const { resources, userData } = fixture()
    const path = resolveUpdateConfigPath(resources, userData)
    expect(path).toBe(join(userData, 'updater-fallback.yml'))
    expect(YAML.parse(readFileSync(path, 'utf8'))).toEqual({ provider: 'github', owner: 'xhslam', repo: 'Gamma', updaterCacheDirName: 'gamma-updater' })
    expect(existsSync(join(resources, 'app-update.yml'))).toBe(false)
  })
  test('When 打包器已生成配置 Then 使用原配置且不创建回退配置', () => {
    const { resources, userData } = fixture()
    const path = join(resources, 'app-update.yml')
    writeFileSync(path, 'provider: generic\nurl: https://example.com/updates\n')
    expect(resolveUpdateConfigPath(resources, userData)).toBe(path)
    expect(readFileSync(path, 'utf8')).toContain('provider: generic')
    expect(existsSync(join(userData, 'updater-fallback.yml'))).toBe(false)
  })
  test('When 原配置损坏 Then 留给更新器报告真实错误，不静默切换源', () => {
    const { resources, userData } = fixture()
    const path = join(resources, 'app-update.yml')
    writeFileSync(path, 'invalid: [')
    expect(resolveUpdateConfigPath(resources, userData)).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('invalid: [')
  })
  test('When 用户目录不可写入 Then 抛出错误而不是返回不存在的配置', () => {
    const { resources, userData } = fixture()
    const blocked = join(userData, 'file')
    writeFileSync(blocked, 'not a directory')
    expect(() => resolveUpdateConfigPath(resources, blocked)).toThrow()
  })
  test('When 重复恢复且旧回退文件被修改 Then 仍仅使用受信任正式源', () => {
    const { resources, userData } = fixture()
    const path = resolveUpdateConfigPath(resources, userData)
    writeFileSync(path, 'provider: generic\nurl: https://example.com\n')
    resolveUpdateConfigPath(resources, userData)
    expect(YAML.parse(readFileSync(path, 'utf8'))).toHaveProperty('repo', 'Gamma')
  })
})
