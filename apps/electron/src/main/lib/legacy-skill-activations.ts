import { lstatSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { SkillActivation } from '@gamma/shared'
import { getRenamedBuiltinSkillSlug } from './legacy-skill-renames'

function exists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}

/** 只归一已成功迁移的受管引用；旧文件仍在、外部目录或链接一律保留。 */
export function normalizeLegacyBuiltinSkillActivation(
  activation: SkillActivation,
  workspacesDirectory: string,
): SkillActivation {
  if (!activation || typeof activation !== 'object' || typeof activation.slug !== 'string') return activation
  if (activation.workspaceSkillPath !== undefined && typeof activation.workspaceSkillPath !== 'string'
    || activation.workspaceSlug !== undefined && typeof activation.workspaceSlug !== 'string'
    || activation.filePath !== undefined && typeof activation.filePath !== 'string') return activation
  const currentSlug = getRenamedBuiltinSkillSlug(activation.slug)
  if (!currentSlug) return activation
  const workspaceSkillPath = activation.workspaceSkillPath?.split(/[\\/]/)
  if (workspaceSkillPath && (workspaceSkillPath.length !== 2 || workspaceSkillPath[0] !== activation.slug || workspaceSkillPath[1] !== 'SKILL.md')) return activation
  let parts: string[]
  if (activation.filePath) {
    parts = relative(resolve(workspacesDirectory), resolve(activation.filePath)).split(sep)
    if (parts.length !== 4 || !parts[0] || parts[0] === '..' || !['skills', 'skills-inactive'].includes(parts[1]!) || parts[2] !== activation.slug || parts[3] !== 'SKILL.md') return activation
    if (activation.workspaceSlug && activation.workspaceSlug !== parts[0]) return activation
  } else {
    if (!activation.workspaceSlug || /[\\/]|^\.{1,2}$/.test(activation.workspaceSlug) || !workspaceSkillPath) return activation
    parts = [activation.workspaceSlug, 'skills', activation.slug, 'SKILL.md']
  }
  const workspacePath = join(workspacesDirectory, parts[0]!)
  const skillParent = join(workspacePath, parts[1]!)
  if (exists(join(skillParent, activation.slug))) return activation
  const currentDirectory = join(skillParent, currentSlug)
  const currentFile = join(currentDirectory, 'SKILL.md')
  try {
    for (const path of [workspacePath, skillParent, currentDirectory]) {
      const stat = lstatSync(path)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return activation
    }
    if (!lstatSync(currentFile).isFile()) return activation
  } catch { return activation }
  return {
    ...activation,
    slug: currentSlug,
    name: activation.name === activation.slug ? currentSlug : activation.name,
    ...(activation.filePath ? { filePath: currentFile } : {}),
    ...(activation.workspaceSkillPath ? { workspaceSkillPath: `${currentSlug}/SKILL.md` } : {}),
  }
}
