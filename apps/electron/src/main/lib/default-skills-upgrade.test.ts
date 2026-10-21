import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAgentWorkspacePath, getAgentWorkspacesIndexPath, getDefaultSkillsDir, getInactiveSkillsDir, getWorkspaceSkillsDir, setConfigHomeForTest } from './config-paths'
import { getAllWorkspaceSkills, upgradeDefaultSkillsInWorkspaces } from './agent-workspace-manager'
import { writeJsonFileAtomic } from './safe-file'

let home: string
let previousHome: string | undefined
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'gamma-default-skill-upgrade-'))
  previousHome = setConfigHomeForTest(home)
  writeJsonFileAtomic(getAgentWorkspacesIndexPath(), { version: 2, workspaces: [{ id: 'workspace-id', slug: 'demo', name: '测试项目', createdAt: 1, updatedAt: 1 }] })
})
afterEach(() => { setConfigHomeForTest(previousHome); rmSync(home, { recursive: true, force: true }) })
function skill(parent: string, slug: string, version = '1.0.0'): string {
  const path = join(parent, slug)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'SKILL.md'), `---\nname: ${slug}\nversion: "${version}"\n---\n\n用户定制流程\n`)
  writeFileSync(join(path, 'custom.txt'), '定制文件')
  return path
}

describe('工作区默认 Skills 升级集成', () => {
  test('Given 新 bundle 不含历史四项 When 升级 Then 仍迁移原安装、保留停用决定并完整备份', () => {
    skill(getDefaultSkillsDir(), 'gamma-coach', '1.2.0')
    const active = getWorkspaceSkillsDir('demo')
    const inactive = getInactiveSkillsDir('demo')
    const build = skill(active, 'proma-build-ai-app')
    writeFileSync(join(build, 'guide.md'), '读取 `proma-cloud-sdk`，再构建应用。')
    skill(inactive, 'proma-cloud-sdk')
    skill(active, 'proma-generate-image')
    skill(inactive, 'proma-gpt-image-2')

    upgradeDefaultSkillsInWorkspaces()
    const installed = getAllWorkspaceSkills('demo')
    for (const [slug, enabled] of [['gamma-build-ai-app', true], ['gamma-cloud-sdk', false], ['gamma-generate-image', true], ['gamma-gpt-image-2', false]] as const) {
      const found = installed.find((item) => item.slug === slug)
      expect(found?.name).toBe(slug)
      expect(found?.enabled).toBe(enabled)
      const parent = enabled ? active : inactive
      expect(readFileSync(join(parent, slug, 'custom.txt'), 'utf8')).toBe('定制文件')
    }
    expect(installed.some((item) => item.slug.startsWith('proma-'))).toBe(false)
    expect(readFileSync(join(active, 'gamma-build-ai-app', 'guide.md'), 'utf8')).toContain('`gamma-cloud-sdk`')
    expect(readFileSync(join(active, 'gamma-build-ai-app', 'SKILL.md'), 'utf8')).toContain('version: "1.0.1"')
    expect(readdirSync(join(getAgentWorkspacePath('demo'), '.legacy-skill-backups', 'skills'))).toHaveLength(2)
    expect(readdirSync(join(getAgentWorkspacePath('demo'), '.legacy-skill-backups', 'skills-inactive'))).toHaveLength(2)
    upgradeDefaultSkillsInWorkspaces()
    expect(readdirSync(join(getAgentWorkspacePath('demo'), '.legacy-skill-backups', 'skills'))).toHaveLength(2)
  })

  test('Given 默认源为空 When 升级 Then 仍修复已有历史模板', () => {
    skill(getInactiveSkillsDir('demo'), 'proma-cloud-sdk')
    upgradeDefaultSkillsInWorkspaces()
    expect(existsSync(join(getInactiveSkillsDir('demo'), 'gamma-cloud-sdk', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(getWorkspaceSkillsDir('demo'), 'gamma-cloud-sdk'))).toBe(false)
  })

  test('Given 缓存残留历史模板、工作区未安装 When 升级 Then 不再注入历史模板', () => {
    skill(getDefaultSkillsDir(), 'gamma-build-ai-app')
    skill(getDefaultSkillsDir(), 'gamma-cloud-sdk')
    skill(getDefaultSkillsDir(), 'gamma-coach', '1.2.0')
    upgradeDefaultSkillsInWorkspaces()
    expect(existsSync(join(getWorkspaceSkillsDir('demo'), 'gamma-coach', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(getWorkspaceSkillsDir('demo'), 'gamma-build-ai-app'))).toBe(false)
    expect(existsSync(join(getWorkspaceSkillsDir('demo'), 'gamma-cloud-sdk'))).toBe(false)
  })

  test('Given 新 Coach 停用且旧 Coach 活跃 When 升级 Then 冲突不覆盖内容也不改变启用决定', () => {
    skill(getDefaultSkillsDir(), 'gamma-coach', '9.0.0')
    const old = skill(getWorkspaceSkillsDir('demo'), 'proma-coach')
    const current = skill(getInactiveSkillsDir('demo'), 'gamma-coach', '1.0.0')
    upgradeDefaultSkillsInWorkspaces()
    expect(readFileSync(join(old, 'SKILL.md'), 'utf8')).toContain('name: proma-coach')
    expect(readFileSync(join(current, 'SKILL.md'), 'utf8')).toContain('version: "1.0.0"')
    expect(existsSync(join(getWorkspaceSkillsDir('demo'), 'gamma-coach'))).toBe(false)
  })
})


test('Given 索引工作区根链接到外部目录 When 升级 Then 不删除或迁移外部内容', () => {
  skill(getDefaultSkillsDir(), 'gamma-coach', '9.0.0')
  const external = join(home, 'external-project')
  const old = skill(join(external, 'skills'), 'proma-build-ai-app')
  const retired = skill(join(external, 'skills'), 'brainstorming')
  const workspace = getAgentWorkspacePath('demo')
  rmSync(workspace, { recursive: true, force: true })
  symlinkSync(external, workspace, 'dir')
  upgradeDefaultSkillsInWorkspaces()
  expect(readFileSync(join(old, 'SKILL.md'), 'utf8')).toContain('name: proma-build-ai-app')
  expect(existsSync(retired)).toBe(true)
  expect(existsSync(join(external, 'skills', 'gamma-coach'))).toBe(false)
  expect(existsSync(join(external, '.legacy-skill-backups'))).toBe(false)
})
