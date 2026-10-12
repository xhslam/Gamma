/**
 * Gamma-managed Pi mode deliberately opts out of Pi's ambient local resources.
 *
 * Gamma supplies the system prompt, Skills and product tools explicitly. Do not
 * let a user project's ancestor context files, extensions, or APPEND_SYSTEM.md
 * silently alter that managed runtime. Inline extension factories remain
 * available: Pi loads them independently of `noExtensions`.
 */
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


/** Keep managed workspace rules ahead of user-project rules in Pi project context. */
export function combineGammaInstructionFiles(
  workspaceFile: GammaProjectInstructionFile | undefined,
  projectFiles: GammaProjectInstructionFile[],
): GammaProjectInstructionFile[] {
  return workspaceFile ? [workspaceFile, ...projectFiles] : projectFiles
}
