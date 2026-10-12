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
