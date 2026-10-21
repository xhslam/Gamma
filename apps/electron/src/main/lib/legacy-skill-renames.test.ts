import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacyCoachSkillDirectory } from './legacy-skill-renames'

let fixtureRoot: string
beforeEach(() => { fixtureRoot = mkdtempSync(join(tmpdir(), 'gamma-coach-migration-')) })
afterEach(() => { rmSync(fixtureRoot, { recursive: true, force: true }) })

function createCoach(parent: string, slug = 'proma-coach'): string {
  const path = join(parent, slug)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'SKILL.md'), `---\nname: ${slug}\nversion: "1.0.0"\n---\n\n用户定制流程\n`, 'utf-8')
  writeFileSync(join(path, 'custom.txt'), '用户补充内容', 'utf-8')
  return path
}

describe('默认 Coach 改名迁移', () => {
  for (const directory of ['skills', 'skills-inactive', 'default-skills']) {
    test(`Given ${directory} 中有旧 Coach 与用户定制 When 改名 Then 保持目录状态并完整备份`, () => {
      const parent = join(fixtureRoot, directory)
      const legacyPath = createCoach(parent)
      const original = readFileSync(join(legacyPath, 'SKILL.md'), 'utf-8')

      const result = migrateLegacyCoachSkillDirectory(parent)

      expect(result.status).toBe('migrated')
      expect(existsSync(legacyPath)).toBe(false)
      expect(readFileSync(join(parent, 'gamma-coach', 'SKILL.md'), 'utf-8')).toContain('name: gamma-coach')
      expect(readFileSync(join(parent, 'gamma-coach', 'custom.txt'), 'utf-8')).toBe('用户补充内容')
      expect(result.backupPath).toBeDefined()
      expect(readFileSync(join(result.backupPath!, 'SKILL.md'), 'utf-8')).toBe(original)
      expect(readFileSync(join(result.backupPath!, 'custom.txt'), 'utf-8')).toBe('用户补充内容')
      expect(readdirSync(parent)).toEqual(['gamma-coach'])

      // 默认内容后续升级不会删除扫描目录之外的定制副本。
      rmSync(join(parent, 'gamma-coach'), { recursive: true })
      createCoach(parent, 'gamma-coach')
      expect(readFileSync(join(result.backupPath!, 'SKILL.md'), 'utf-8')).toBe(original)
    })
  }

  test('Given 旧 Coach 已迁移 When 下次启动 Then 不重复创建备份', () => {
    const parent = join(fixtureRoot, 'skills')
    createCoach(parent)
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('migrated')
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('absent')
    expect(readdirSync(join(fixtureRoot, '.legacy-skill-backups', 'skills'))).toHaveLength(1)
  })

  test('Given 同一目录新旧 Coach 并存 When 迁移 Then 两份内容原样保留且不覆盖', () => {
    const parent = join(fixtureRoot, 'skills')
    const legacy = createCoach(parent)
    const current = createCoach(parent, 'gamma-coach')
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('conflict')
    expect(readFileSync(join(legacy, 'SKILL.md'), 'utf-8')).toContain('name: proma-coach')
    expect(readFileSync(join(current, 'SKILL.md'), 'utf-8')).toContain('name: gamma-coach')
    expect(existsSync(join(fixtureRoot, '.legacy-skill-backups'))).toBe(false)
  })

  test('Given 新 Coach 在 inactive、旧 Coach 在 active When 迁移 Then 尊重新 Skill 的停用决定', () => {
    const active = join(fixtureRoot, 'skills')
    const inactive = join(fixtureRoot, 'skills-inactive')
    const legacy = createCoach(active)
    createCoach(inactive, 'gamma-coach')
    expect(migrateLegacyCoachSkillDirectory(active, { conflictingParentDirs: [inactive] }).status).toBe('conflict')
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(join(active, 'gamma-coach'))).toBe(false)
  })

  test('Given 旧 Coach 是外部目录链接 When 迁移 Then 跳过并不修改链接目标', () => {
    const parent = join(fixtureRoot, 'skills')
    const external = createCoach(join(fixtureRoot, 'external'))
    mkdirSync(parent)
    symlinkSync(external, join(parent, 'proma-coach'), 'dir')
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('invalid')
    expect(readFileSync(join(external, 'SKILL.md'), 'utf-8')).toContain('name: proma-coach')
    expect(existsSync(join(parent, 'gamma-coach'))).toBe(false)
  })

  test('Given SKILL.md 是链接或目录内容缺失 When 迁移 Then 保留旧目录避免创建无效新 Skill', () => {
    const parent = join(fixtureRoot, 'skills')
    const legacy = createCoach(parent)
    rmSync(join(legacy, 'SKILL.md'))
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('invalid')
    writeFileSync(join(fixtureRoot, 'user.md'), 'name: proma-coach')
    symlinkSync(join(fixtureRoot, 'user.md'), join(legacy, 'SKILL.md'))
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('invalid')
    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(join(fixtureRoot, 'user.md'), 'utf-8')).toBe('name: proma-coach')
  })

  test('Given 备份目录被替换为外部链接 When 迁移 Then 安全停止且原 Skill 完整保留', () => {
    const parent = join(fixtureRoot, 'skills')
    const legacy = createCoach(parent)
    const unrelated = join(fixtureRoot, 'unrelated')
    mkdirSync(unrelated)
    symlinkSync(unrelated, join(fixtureRoot, '.legacy-skill-backups'), 'dir')
    expect(migrateLegacyCoachSkillDirectory(parent).status).toBe('failed')
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(join(parent, 'gamma-coach'))).toBe(false)
    expect(readdirSync(unrelated)).toEqual([])
  })
})

// 历史模板已不在新版 bundle，仍必须迁移用户已有安装。
describe('历史内置 Skills 改名', () => {
  test('Given 四个旧模板与自建同前缀 Skill When 迁移 Then 逐个改名、完整备份且不碰自建 Skill', async () => {
    const { migrateLegacyBuiltinSkillDirectories, LEGACY_BUILTIN_SKILL_RENAMES } = await import('./legacy-skill-renames')
    const parent = join(fixtureRoot, 'skills-inactive')
    const historical = LEGACY_BUILTIN_SKILL_RENAMES.slice(1)
    for (const { legacySlug } of historical) createCoach(parent, legacySlug)
    const custom = createCoach(parent, 'proma-my-own-tool')
    const results = migrateLegacyBuiltinSkillDirectories(parent)
    for (const { legacySlug, currentSlug } of historical) {
      const result = results.find((item) => item.legacySlug === legacySlug)!
      expect(result.status).toBe('migrated')
      expect(readFileSync(join(parent, currentSlug, 'SKILL.md'), 'utf8')).toContain(`name: ${currentSlug}`)
      expect(readFileSync(join(parent, currentSlug, 'custom.txt'), 'utf8')).toBe('用户补充内容')
      expect(readFileSync(join(result.backupPath!, 'SKILL.md'), 'utf8')).toContain(`name: ${legacySlug}`)
      expect(existsSync(join(parent, legacySlug))).toBe(false)
    }
    expect(readFileSync(join(custom, 'SKILL.md'), 'utf8')).toContain('name: proma-my-own-tool')
    expect(migrateLegacyBuiltinSkillDirectories(parent).every((item) => item.status === 'absent')).toBe(true)
    expect(readdirSync(join(fixtureRoot, '.legacy-skill-backups', 'skills-inactive'))).toHaveLength(4)
  })

  test('Given 引用 Markdown 与外部 Markdown 链接 When 改名 Then 更新目录内引用且不改链接目标', async () => {
    const { migrateLegacyBuiltinSkillDirectories } = await import('./legacy-skill-renames')
    const parent = join(fixtureRoot, 'skills')
    const legacy = createCoach(parent, 'proma-build-ai-app')
    createCoach(parent, 'proma-cloud-sdk')
    mkdirSync(join(legacy, 'references'))
    writeFileSync(join(legacy, 'references', 'guide.md'), '使用 `proma-cloud-sdk` 调用服务')
    const external = join(fixtureRoot, 'external.md')
    writeFileSync(external, '使用 `proma-cloud-sdk` 调用服务')
    symlinkSync(external, join(legacy, 'references', 'external.md'))
    const result = migrateLegacyBuiltinSkillDirectories(parent).find((item) => item.legacySlug === 'proma-build-ai-app')!
    expect(result.status).toBe('migrated')
    expect(readFileSync(join(parent, 'gamma-build-ai-app', 'references', 'guide.md'), 'utf8')).toContain('gamma-cloud-sdk')
    expect(readFileSync(external, 'utf8')).toContain('proma-cloud-sdk')
    expect(readFileSync(join(result.backupPath!, 'references', 'guide.md'), 'utf8')).toContain('proma-cloud-sdk')
  })
})


test('Given 依赖 Skill 的 Markdown 链接无效 When 其余 Skill 改名 Then 保留可用旧依赖引用', async () => {
  const { migrateLegacyBuiltinSkillDirectories } = await import('./legacy-skill-renames')
  const parent = join(fixtureRoot, 'skills')
  const build = createCoach(parent, 'proma-build-ai-app')
  writeFileSync(join(build, 'guide.md'), '读取 `proma-cloud-sdk`，调用 proma_cloud。')
  const cloud = createCoach(parent, 'proma-cloud-sdk')
  const external = join(fixtureRoot, 'external-cloud.md')
  writeFileSync(external, 'name: proma-cloud-sdk')
  rmSync(join(cloud, 'SKILL.md'))
  symlinkSync(external, join(cloud, 'SKILL.md'))
  const results = migrateLegacyBuiltinSkillDirectories(parent)
  expect(results.find((item) => item.legacySlug === 'proma-build-ai-app')?.status).toBe('migrated')
  expect(results.find((item) => item.legacySlug === 'proma-cloud-sdk')?.status).toBe('invalid')
  expect(readFileSync(join(parent, 'gamma-build-ai-app', 'guide.md'), 'utf8')).toContain('`proma-cloud-sdk`')
  expect(existsSync(join(parent, 'gamma-cloud-sdk'))).toBe(false)
  expect(readFileSync(external, 'utf8')).toBe('name: proma-cloud-sdk')
})

test('Given 工作区根是外部链接 When 迁移 Then 外部 Skill 和备份位置均不写入', async () => {
  const { migrateLegacyBuiltinSkillDirectories } = await import('./legacy-skill-renames')
  const external = join(fixtureRoot, 'external')
  const legacy = createCoach(join(external, 'skills'), 'proma-build-ai-app')
  symlinkSync(external, join(fixtureRoot, 'linked-workspace'), 'dir')
  const results = migrateLegacyBuiltinSkillDirectories(join(fixtureRoot, 'linked-workspace', 'skills'))
  expect(results.find((item) => item.legacySlug === 'proma-build-ai-app')?.status).toBe('invalid')
  expect(readFileSync(join(legacy, 'SKILL.md'), 'utf8')).toContain('name: proma-build-ai-app')
  expect(existsSync(join(external, '.legacy-skill-backups'))).toBe(false)
})
