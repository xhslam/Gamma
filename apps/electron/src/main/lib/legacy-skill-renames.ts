import { cpSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { renameIfDestinationAbsentWithRetry } from './fs-retry'
import { writeTextFileAtomic } from './safe-file'

export const LEGACY_COACH_SKILL_SLUG = 'proma-coach'
export const GAMMA_COACH_SKILL_SLUG = 'gamma-coach'

export interface LegacyCoachSkillMigrationOptions {
  /** 工作区另一种启用状态的目录；已有新 Skill 时不改变其启用决定。 */
  conflictingParentDirs?: readonly string[]
}

export interface LegacyCoachSkillMigrationResult {
  status: 'absent' | 'migrated' | 'conflict' | 'invalid' | 'failed'
  backupPath?: string
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function isRegularDirectory(path: string): boolean {
  const stat = lstatSync(path)
  return stat.isDirectory() && !stat.isSymbolicLink()
}

function ensureBackupDirectory(path: string): void {
  if (!pathExists(path)) mkdirSync(path)
  if (!isRegularDirectory(path)) throw new Error('旧 Skill 备份目录不是普通目录')
}

/**
 * 保留完整副本后改名旧 Coach，既有版本升级随后更新默认内容。
 * 同目录移动保持 active/inactive 状态；冲突、链接或失败均保留原内容。
 */
export function migrateLegacyCoachSkillDirectory(
  parentDir: string,
  options: LegacyCoachSkillMigrationOptions = {},
): LegacyCoachSkillMigrationResult {
  const legacyPath = join(parentDir, LEGACY_COACH_SKILL_SLUG)
  const currentPath = join(parentDir, GAMMA_COACH_SKILL_SLUG)
  let backupPath: string | undefined

  try {
    if (!pathExists(parentDir) || !pathExists(legacyPath)) return { status: 'absent' }
    if (!isRegularDirectory(parentDir) || !isRegularDirectory(legacyPath)) return { status: 'invalid' }
    const legacySkillMd = join(legacyPath, 'SKILL.md')
    if (!pathExists(legacySkillMd) || !lstatSync(legacySkillMd).isFile()) return { status: 'invalid' }
    if (pathExists(currentPath) || options.conflictingParentDirs?.some((dir) => pathExists(join(dir, GAMMA_COACH_SKILL_SLUG)))) {
      console.warn('[Skill 改名] 已有 gamma-coach，保留旧目录等待用户处理')
      return { status: 'conflict' }
    }

    // 备份放在 Skills 扫描目录外，避免旧、新 Coach 同时注入 Agent。
    const backupRoot = join(dirname(parentDir), '.legacy-skill-backups')
    ensureBackupDirectory(backupRoot)
    const backupParent = join(backupRoot, basename(parentDir))
    ensureBackupDirectory(backupParent)
    backupPath = join(backupParent, `${LEGACY_COACH_SKILL_SLUG}-${randomUUID()}`)
    cpSync(legacyPath, backupPath, { recursive: true, dereference: false, errorOnExist: true, force: false })

    if (!renameIfDestinationAbsentWithRetry(legacyPath, currentPath)) {
      return { status: 'conflict', backupPath }
    }

    const currentSkillMd = join(currentPath, 'SKILL.md')
    const content = readFileSync(currentSkillMd, 'utf-8')
    const frontmatter = content.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---/)
    if (frontmatter) {
      const renamed = frontmatter[0].replace(
        /^(name:[ \t]*)(['"]?)proma-coach\2([ \t]*\r?)$/m,
        `$1$2${GAMMA_COACH_SKILL_SLUG}$2$3`,
      )
      if (renamed !== frontmatter[0]) writeTextFileAtomic(currentSkillMd, renamed + content.slice(frontmatter[0].length))
    }

    console.log('[Skill 改名] proma-coach → gamma-coach；旧内容已完整备份')
    return { status: 'migrated', backupPath }
  } catch (error) {
    console.warn('[Skill 改名] Coach 迁移失败，保留已有内容和备份:', error)
    return { status: 'failed', ...(backupPath ? { backupPath } : {}) }
  }
}
