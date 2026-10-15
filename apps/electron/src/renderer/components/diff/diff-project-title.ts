import { arePathsEqual } from '@/lib/session-file-changes'

/** 项目显示名与实际Git路径分开；附加仓库仍使用自己的目录名。 */
export function getDiffProjectTitle(
  gitRoot: string,
  projectRootPath?: string,
  projectName?: string,
  caseInsensitive = false,
): string {
  const name = projectName?.trim()
  if (gitRoot && projectRootPath && name && arePathsEqual(gitRoot, projectRootPath, caseInsensitive)) return name
  const normalized = gitRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').pop() || normalized || '/'
}
