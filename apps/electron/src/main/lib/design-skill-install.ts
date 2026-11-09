import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DESIGN_SKILL_SLUG, DESIGN_SOURCE_REVISION, DESIGN_SOURCE_URL } from '@gamma/shared'

const execFileAsync = promisify(execFile)

/** 不运行 npm hooks 或上游脚本，只检出固定 revision 的 claude-design。 */
export async function fetchDesignSource(directory: string): Promise<string> {
  const repo = join(directory, 'source')
  const options = { timeout: 180_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
  await execFileAsync('git', ['-c', 'core.hooksPath=', 'init', repo], options)
  const git = async (args: string[]): Promise<void> => {
    await execFileAsync('git', ['-C', repo, '-c', 'core.hooksPath=', ...args], options)
  }
  await git(['remote', 'add', 'origin', `${DESIGN_SOURCE_URL}.git`])
  await git(['fetch', '--depth=1', '--filter=blob:none', 'origin', DESIGN_SOURCE_REVISION])
  await git(['sparse-checkout', 'set', `skills/${DESIGN_SKILL_SLUG}`])
  await git(['checkout', '--detach', 'FETCH_HEAD'])
  return repo
}

/** 拒绝符号链接和异常大目录；上游文件不能通过链接写到工作区外。 */
async function assertRegularTree(directory: string): Promise<void> {
  let bytes = 0
  let count = 0
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 32 || ++count > 20_000) throw new Error('design Skill 目录超出安全大小限制')
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('design Skill 不允许包含符号链接')
    if (stat.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry), depth + 1)
    } else if (stat.isFile()) {
      bytes += stat.size
      if (bytes > 256 * 1024 * 1024) throw new Error('design Skill 超出 256 MB 大小限制')
    } else throw new Error('design Skill 包含不支持的文件类型')
  }
  await visit(directory, 0)
}

export interface InstallDesignSkillOptions {
  skillsDirectory: string
  /** 同名禁用 Skill 也应阻止覆盖。 */
  inactiveSkillsDirectory: string
  fetchSource?: (directory: string) => Promise<string>
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** 暂存于同一父目录，完整复制后再发布；失败不留下半个活跃 Skill。 */
export async function installDesignSkill(options: InstallDesignSkillOptions): Promise<void> {
  const { skillsDirectory, inactiveSkillsDirectory, fetchSource = fetchDesignSource } = options
  await mkdir(skillsDirectory, { recursive: true })
  const target = join(skillsDirectory, DESIGN_SKILL_SLUG)
  const inactive = join(inactiveSkillsDirectory, DESIGN_SKILL_SLUG)
  if (await exists(target) || await exists(inactive)) throw new Error('已存在 claude-design，请在 MCP/Skills 中管理，不会覆盖或自动启用')
  const staging = await mkdtemp(join(skillsDirectory, '.design-install-'))
  try {
    const repo = await fetchSource(staging)
    const source = join(repo, 'skills', DESIGN_SKILL_SLUG)
    await assertRegularTree(source)
    const skill = await readFile(join(source, 'SKILL.md'), 'utf8')
    if (!/^name:\s*claude-design\s*$/m.test(skill)) throw new Error('下载的内容不是 claude-design Skill')
    const prepared = join(staging, DESIGN_SKILL_SLUG)
    await cp(source, prepared, { recursive: true, errorOnExist: true, force: false })
    for (const name of ['LICENSE', 'NOTICE.md']) {
      await cp(join(repo, name), join(prepared, `UPSTREAM-${name}`), { errorOnExist: true, force: false })
    }
    if (await exists(target) || await exists(inactive)) throw new Error('安装期间出现同名 Skill，已停止以避免覆盖')
    await rename(prepared, target)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
