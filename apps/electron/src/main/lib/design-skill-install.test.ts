import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESIGN_SKILL_SLUG } from '@gamma/shared'
import { installDesignSkill } from './design-skill-install'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gamma-design-test-'))
  temporary.push(root)
  const skillsDirectory = join(root, 'skills')
  const inactiveSkillsDirectory = join(root, 'skills-inactive')
  const fetchSource = async (directory: string): Promise<string> => {
    const repo = join(directory, 'repo')
    const source = join(repo, 'skills', DESIGN_SKILL_SLUG)
    await mkdir(join(source, 'scripts'), { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '---\nname: claude-design\n---\n# Design')
    await writeFile(join(source, 'scripts', 'artifact.mjs'), 'throw new Error("安装不得执行此代码")')
    await writeFile(join(repo, 'LICENSE'), 'MIT for own code')
    await writeFile(join(repo, 'NOTICE.md'), 'Mixed license')
    return repo
  }
  return { root, skillsDirectory, inactiveSkillsDirectory, fetchSource }
}

describe('Given 用户明确确认本地 design 安装', () => {
  test('When 安装完成 Then 完整发布 Skill 和原始许可，且不运行第三方代码', async () => {
    const options = await fixture()
    await installDesignSkill(options)
    const installed = join(options.skillsDirectory, DESIGN_SKILL_SLUG)
    expect(await readFile(join(installed, 'UPSTREAM-NOTICE.md'), 'utf8')).toBe('Mixed license')
    expect(await readFile(join(installed, 'UPSTREAM-LICENSE'), 'utf8')).toBe('MIT for own code')
    expect(await readdir(options.skillsDirectory)).toEqual([DESIGN_SKILL_SLUG])
  })
  for (const inactive of [false, true]) {
    test(`When 同名 Skill 已${inactive ? '停用' : '安装'} Then 不覆盖、不启用也不下载`, async () => {
      const options = await fixture()
      const folder = join(inactive ? options.inactiveSkillsDirectory : options.skillsDirectory, DESIGN_SKILL_SLUG)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'SKILL.md'), '用户自定义版本')
      let downloaded = false
      await expect(installDesignSkill({ ...options, fetchSource: async () => { downloaded = true; return '' } })).rejects.toThrow('已存在')
      expect(downloaded).toBe(false)
      expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe('用户自定义版本')
    })
  }
  test('When 网络失败 Then 暂存目录被清理且不存在半安装 Skill', async () => {
    const options = await fixture()
    await expect(installDesignSkill({ ...options, fetchSource: async () => { throw new Error('网络断开') } })).rejects.toThrow('网络断开')
    expect(await readdir(options.skillsDirectory)).toEqual([])
  })
  test('When 上游含越界符号链接 Then 拒绝安装并清理', async () => {
    const options = await fixture()
    await expect(installDesignSkill({ ...options, fetchSource: async (directory) => {
      const repo = await options.fetchSource(directory)
      await symlink(options.root, join(repo, 'skills', DESIGN_SKILL_SLUG, 'escape'))
      return repo
    } })).rejects.toThrow('符号链接')
    expect(await readdir(options.skillsDirectory)).toEqual([])
  })
  test('When 上游 Skill 不匹配 Then 不发布到活跃目录', async () => {
    const options = await fixture()
    await expect(installDesignSkill({ ...options, fetchSource: async (directory) => {
      const repo = await options.fetchSource(directory)
      await writeFile(join(repo, 'skills', DESIGN_SKILL_SLUG, 'SKILL.md'), 'name: other-skill')
      return repo
    } })).rejects.toThrow('不是 claude-design')
    expect(await readdir(options.skillsDirectory)).toEqual([])
  })
})
