import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfigDir, setConfigHomeForTest } from './config-paths'
import { getGlobalAgentsMdPath, readAgentsMdFile, readGlobalAgentsInstruction } from './agent-instruction-files'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'gamma-global-agents-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('显式全局规则读取', () => {
  test('Given 用户配置根 When 获取全局路径 Then 沿用现有配置目录约定', () => {
    const previous = setConfigHomeForTest(fixture())
    try {
      expect(getGlobalAgentsMdPath()).toBe(join(getConfigDir(), 'AGENTS.md'))
    } finally { setConfigHomeForTest(previous) }
  })

  test('Given 没有工作区规则 When 新对话加载全局规则 Then 生效且修改和删除无需重启', () => {
    const path = join(fixture(), 'AGENTS.md')
    const warnings: string[] = []
    const warn = (message: string): void => { warnings.push(message) }
    expect(readGlobalAgentsInstruction(path, warn)).toBeUndefined()
    expect(warnings).toEqual([])
    writeFileSync(path, 'GLOBAL_FIRST')
    expect(readGlobalAgentsInstruction(path, warn)?.content).toBe('GLOBAL_FIRST')
    writeFileSync(path, 'GLOBAL_UPDATED')
    expect(readGlobalAgentsInstruction(path, warn)?.content).toBe('GLOBAL_UPDATED')
    rmSync(path)
    expect(readGlobalAgentsInstruction(path, warn)).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('Given 目录或不合法编码 When 读取 Then 隔离错误并记录来源，不阻断对话', () => {
    const root = fixture()
    const path = join(root, 'AGENTS.md')
    const warnings: string[] = []
    const warn = (message: string): void => { warnings.push(message) }
    mkdirSync(path)
    expect(readGlobalAgentsInstruction(path, warn)).toBeUndefined()
    rmSync(path, { recursive: true })
    writeFileSync(path, Buffer.from([0xc3, 0x28]))
    expect(readGlobalAgentsInstruction(path, warn)).toBeUndefined()
    writeFileSync(path, Buffer.from([0x61, 0, 0x62]))
    expect(readGlobalAgentsInstruction(path, warn)).toBeUndefined()
    expect(warnings).toHaveLength(3)
    expect(warnings.every((message) => message.includes(path))).toBe(true)
  })

  test.skipIf(process.getuid?.() === 0)('Given 无文件读取权限 When 加载全局规则 Then 记录权限错误且返回空层', () => {
    const path = join(fixture(), 'AGENTS.md')
    writeFileSync(path, 'PRIVATE_RULE')
    chmodSync(path, 0)
    const warnings: string[] = []
    try {
      expect(readGlobalAgentsInstruction(path, (message) => { warnings.push(message) })).toBeUndefined()
      expect(warnings[0]).toContain('EACCES')
    } finally { chmodSync(path, 0o600) }
  })

  test('Given 超过现有工作区10MB上限 When 读取 Then 不截断注入而是跳过并明确提示', () => {
    const path = join(fixture(), 'AGENTS.md')
    writeFileSync(path, '')
    truncateSync(path, 10 * 1024 * 1024 + 1)
    expect(() => readAgentsMdFile(path)).toThrow('10 MB')
    const warnings: string[] = []
    expect(readGlobalAgentsInstruction(path, (message) => { warnings.push(message) })).toBeUndefined()
    expect(warnings[0]).toContain('10 MB')
  })

  test('Given 共享读取入口 When 文件缺失或正常 Then 保留工作区文件返回契约', () => {
    const path = join(fixture(), 'AGENTS.md')
    expect(readAgentsMdFile(path)).toEqual({ relativePath: 'AGENTS.md', isText: true, size: 0, content: '' })
    writeFileSync(path, '中文规则')
    expect(readAgentsMdFile(path)).toEqual({ relativePath: 'AGENTS.md', isText: true, size: 12, content: '中文规则' })
  })
})
