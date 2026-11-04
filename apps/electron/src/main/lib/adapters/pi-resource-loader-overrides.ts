/**
 * Gamma-managed Pi mode deliberately opts out of Pi's ambient local resources.
 *
 * Gamma supplies the system prompt, Skills and product tools explicitly. Do not
 * let a user project's ancestor context files, extensions, or APPEND_SYSTEM.md
 * silently alter that managed runtime. Inline extension factories remain
 * available: Pi loads them independently of `noExtensions`.
 */
import { normalizeProjectPathForComparison } from '../project-instruction-resolver'

export interface GammaProjectInstructionFile {
  path: string
  content: string
}

export function createGammaManagedResourceLoaderOptions() {
  return {
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    // An explicit empty source prevents Pi from discovering APPEND_SYSTEM.md.
    appendSystemPrompt: [],
  }
}

/**
 * Pi still owns the final <project_context> formatting. Gamma supplies this override only after validating explicit Gamma-managed
 * workspace paths and user-authorized project paths, so no ambient context-file
 * discovery is re-enabled.
 */
export function createGammaProjectInstructionFilesOverride(files: GammaProjectInstructionFile[]) {
  const agentsFiles = files.map(({ path, content }) => ({ path, content }))
  return () => ({ agentsFiles })
}


/** 显式叠加三层规则；同一真实路径只保留靠后的层，避免重复并保持覆盖顺序。 */
export function combineGammaInstructionFiles(
  workspaceFile: GammaProjectInstructionFile | undefined,
  projectFiles: GammaProjectInstructionFile[],
  globalFile?: GammaProjectInstructionFile,
): GammaProjectInstructionFile[] {
  const layers = [
    ...(globalFile ? [{ file: globalFile, source: '全局' }] : []),
    ...(workspaceFile ? [{ file: workspaceFile, source: '工作区' }] : []),
    ...projectFiles.map((file) => ({ file, source: '项目' })),
  ]
  const seen = new Set<string>()
  return layers.reverse().filter(({ file }) => {
    const key = normalizeProjectPathForComparison(file.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).reverse().map(({ file, source }) => ({
    path: file.path,
    content: `规则来源：${source}（${file.path}）\n规则叠加顺序：全局 < 工作区 < 项目；全部加载，冲突时以靠后的规则为准。项目规则仅适用于对应项目范围。\n\n${file.content}`,
  }))
}
