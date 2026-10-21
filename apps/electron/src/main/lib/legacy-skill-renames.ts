import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { renameIfDestinationAbsentWithRetry, rmSyncWithRetry } from './fs-retry'
import { writeTextFileAtomic } from './safe-file'
import { migrateLegacyBuiltinSkillContent } from './legacy-skill-content'

export const LEGACY_COACH_SKILL_SLUG = 'proma-coach'
export const GAMMA_COACH_SKILL_SLUG = 'gamma-coach'

export interface LegacyBuiltinSkillRename {
  legacySlug: string
  currentSlug: string
}

/** 只处理应用曾分发的明确标识，不按 proma-* 通配改名用户 Skill。 */
export const LEGACY_BUILTIN_SKILL_RENAMES: readonly LegacyBuiltinSkillRename[] = [
  { legacySlug: LEGACY_COACH_SKILL_SLUG, currentSlug: GAMMA_COACH_SKILL_SLUG },
  { legacySlug: 'proma-build-ai-app', currentSlug: 'gamma-build-ai-app' },
  { legacySlug: 'proma-cloud-sdk', currentSlug: 'gamma-cloud-sdk' },
  { legacySlug: 'proma-generate-image', currentSlug: 'gamma-generate-image' },
  { legacySlug: 'proma-gpt-image-2', currentSlug: 'gamma-gpt-image-2' },
]

export function getRenamedBuiltinSkillSlug(slug: string): string | undefined {
  return LEGACY_BUILTIN_SKILL_RENAMES.find((item) => item.legacySlug === slug)?.currentSlug
}

export function isLegacyBuiltinSkillSlug(slug: string): boolean {
  return getRenamedBuiltinSkillSlug(slug) !== undefined
}

/** 已移出 bundle 的历史模板仅在原有安装处保留，不再注入新工作区。 */
export function isHistoricalBuiltinSkillSlug(slug: string): boolean {
  return LEGACY_BUILTIN_SKILL_RENAMES.some((item) => item.legacySlug !== LEGACY_COACH_SKILL_SLUG && item.currentSlug === slug)
}

export interface LegacyCoachSkillMigrationOptions {
  /** 工作区另一种启用状态的目录；已有新 Skill 时不改变其启用决定。 */
  conflictingParentDirs?: readonly string[]
}

export interface LegacyCoachSkillMigrationResult {
  status: 'absent' | 'migrated' | 'conflict' | 'invalid' | 'failed'
  backupPath?: string
}

export interface LegacyBuiltinSkillMigrationResult extends LegacyCoachSkillMigrationResult, LegacyBuiltinSkillRename {
  parentDir: string
}

interface PreparedSkillMigrationResult extends LegacyCoachSkillMigrationResult {
  originalPath?: string
}

/** 缓存与工作区都处理，包含已不随新版 bundle 分发的历史内置 Skill。 */
export function migrateLegacyBuiltinSkillDirectories(
  parentDir: string,
  options: LegacyCoachSkillMigrationOptions = {},
): LegacyBuiltinSkillMigrationResult[] {
  return migrateLegacyBuiltinSkillDirectoriesInParents([parentDir], options)
}

/** active/inactive 同批处理；只有最终确实存在的新 Skill 才能用于跨 Skill 引用。 */
export function migrateLegacyBuiltinSkillDirectoriesInParents(
  parentDirs: readonly string[],
  options: LegacyCoachSkillMigrationOptions = {},
): LegacyBuiltinSkillMigrationResult[] {
  const prepared = parentDirs.flatMap((parentDir) => LEGACY_BUILTIN_SKILL_RENAMES.map((rename) => ({
    ...rename, parentDir,
    ...migrateLegacySkillDirectory(parentDir, rename, { conflictingParentDirs: [...parentDirs.filter((dir) => dir !== parentDir), ...options.conflictingParentDirs ?? []] }),
  })))
  const available = new Set(LEGACY_BUILTIN_SKILL_RENAMES.filter(({ currentSlug }) =>
    [...parentDirs, ...options.conflictingParentDirs ?? []].some((dir) => isRegularSkillDirectory(join(dir, currentSlug))),
  ).map(({ currentSlug }) => currentSlug))
  try {
    for (const item of prepared) {
      if (item.status !== 'migrated') continue
      rewriteSkillMarkdown(item.backupPath!, item.legacySlug, item.currentSlug, available, join(item.parentDir, item.currentSlug))
    }
  } catch (error) {
    console.warn('[Skill 改名] 跨 Skill 引用更新失败，恢复本批旧目录:', error)
    for (const item of prepared) {
      if (item.status !== 'migrated' || !item.originalPath) continue
      try {
        const quarantinePath = join(dirname(item.originalPath), `.failed-${randomUUID()}`)
        if (renameIfDestinationAbsentWithRetry(join(item.parentDir, item.currentSlug), quarantinePath)) {
          renameIfDestinationAbsentWithRetry(item.originalPath, join(item.parentDir, item.legacySlug))
        }
      } catch (rollbackError) {
        console.warn('[Skill 改名] 回滚目录失败，原文及失败副本均已保留:', rollbackError)
      }
      item.status = 'failed'
    }
  }
  for (const item of prepared) if (item.status === 'migrated') cleanupOriginal(item.originalPath)
  return prepared.map(({ originalPath: _originalPath, ...result }) => result)
}

function isRegularSkillDirectory(path: string): boolean {
  try { return isRegularDirectory(path) && lstatSync(join(path, 'SKILL.md')).isFile() } catch { return false }
}

function cleanupOriginal(path?: string): void {
  if (!path) return
  try { rmSyncWithRetry(path, { recursive: true, force: true }) } catch (error) {
    console.warn('[Skill 改名] 暂存原目录清理失败，保留扫描目录外的副本:', error)
  }
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
 * 保留完整副本后改名历史内置 Skill，既有版本升级随后更新默认内容。
 * 同目录移动保持 active/inactive 状态；冲突、链接或失败均保留原内容。
 */
export function migrateLegacyCoachSkillDirectory(
  parentDir: string,
  options: LegacyCoachSkillMigrationOptions = {},
): LegacyCoachSkillMigrationResult {
  const { originalPath, ...result } = migrateLegacySkillDirectory(parentDir, LEGACY_BUILTIN_SKILL_RENAMES[0]!, options)
  if (result.status === 'migrated') cleanupOriginal(originalPath)
  return result
}

function migrateLegacySkillDirectory(
  parentDir: string,
  { legacySlug, currentSlug }: LegacyBuiltinSkillRename,
  options: LegacyCoachSkillMigrationOptions,
): PreparedSkillMigrationResult {
  const legacyPath = join(parentDir, legacySlug)
  const currentPath = join(parentDir, currentSlug)
  let backupPath: string | undefined
  let heldPath: string | undefined
  let stagingPath: string | undefined

  try {
    if (!pathExists(parentDir) || !pathExists(legacyPath)) return { status: 'absent' }
    if (!isRegularDirectory(dirname(parentDir)) || !isRegularDirectory(parentDir) || !isRegularDirectory(legacyPath)) return { status: 'invalid' }
    const legacySkillMd = join(legacyPath, 'SKILL.md')
    if (!pathExists(legacySkillMd) || !lstatSync(legacySkillMd).isFile()) return { status: 'invalid' }
    if (pathExists(currentPath) || options.conflictingParentDirs?.some((dir) => pathExists(join(dir, currentSlug)))) {
      console.warn(`[Skill 改名] 已有 ${currentSlug}，保留旧目录等待用户处理`)
      return { status: 'conflict' }
    }

    // 备份放在 Skills 扫描目录外，避免旧、新 Skill 同时注入 Agent。
    const backupRoot = join(dirname(parentDir), '.legacy-skill-backups')
    ensureBackupDirectory(backupRoot)
    const backupParent = join(backupRoot, basename(parentDir))
    ensureBackupDirectory(backupParent)
    backupPath = join(backupParent, `${legacySlug}-${randomUUID()}`)
    cpSync(legacyPath, backupPath, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false })

    stagingPath = join(backupParent, `.staging-${randomUUID()}`)
    cpSync(backupPath, stagingPath, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false })
    rewriteSkillMarkdown(stagingPath, legacySlug, currentSlug, new Set([currentSlug]))

    // 转换全部成功后再发布目录，转换失败不会改动原目录。
    heldPath = join(backupParent, `.original-${randomUUID()}`)
    if (!renameIfDestinationAbsentWithRetry(legacyPath, heldPath)) throw new Error('旧 Skill 暂存路径已存在')
    if (!renameIfDestinationAbsentWithRetry(stagingPath, currentPath)) {
      renameIfDestinationAbsentWithRetry(heldPath, legacyPath)
      return { status: 'conflict', backupPath }
    }
    stagingPath = undefined
    console.log(`[Skill 改名] ${legacySlug} → ${currentSlug}；旧内容已完整备份`)
    return { status: 'migrated', backupPath, originalPath: heldPath }
  } catch (error) {
    if (heldPath && pathExists(heldPath)) {
      try {
        renameIfDestinationAbsentWithRetry(heldPath, legacyPath)
      } catch (rollbackError) {
        console.warn('[Skill 改名] 目录回滚失败，完整原文仍保留在备份:', rollbackError)
      }
    }
    console.warn(`[Skill 改名] ${legacySlug} 迁移失败，保留已有内容和备份:`, error)
    return { status: 'failed', ...(backupPath ? { backupPath } : {}) }
  } finally {
    if (stagingPath) {
      try { rmSyncWithRetry(stagingPath, { recursive: true, force: true }) } catch { /* 扫描目录外的暂存保留，不能影响启动。 */ }
    }
  }
}

function rewriteSkillMarkdown(
  directory: string, legacySlug: string, currentSlug: string, availableCurrentSlugs: ReadonlySet<string>, targetDirectory = directory,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const targetPath = join(targetDirectory, entry.name)
    if (entry.isDirectory()) rewriteSkillMarkdown(path, legacySlug, currentSlug, availableCurrentSlugs, targetPath)
    else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      const content = readFileSync(path, 'utf-8')
      const renamed = migrateLegacyBuiltinSkillContent(content, legacySlug, currentSlug, availableCurrentSlugs)
      if (!lstatSync(targetPath).isFile()) throw new Error('Skill Markdown 目标不再是普通文件')
      if (renamed !== readFileSync(targetPath, 'utf-8')) writeTextFileAtomic(targetPath, renamed)
    }
  }
}
