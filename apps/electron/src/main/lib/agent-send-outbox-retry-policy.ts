import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { AgentSendOutboxEntry, AgentSubmitOrEnqueueInput, GammaPermissionMode } from '@gamma/shared'

interface CurrentRetryContext {
  workspaceId: string
  permissionMode: GammaPermissionMode
  directories: string[]
  files: string[]
}

function canonicalExisting(path: string): string | null {
  try { return realpathSync(path) } catch { return null }
}
function contains(root: string, path: string): boolean {
  const part = relative(root, path)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

/** 旧快照不能恢复已撤销的目录授权或旧高权限模式。 */
export function prepareOutboxRetryInput(entry: AgentSendOutboxEntry, context: CurrentRetryContext): AgentSubmitOrEnqueueInput {
  if (entry.input.workspaceId && entry.input.workspaceId !== context.workspaceId) throw new Error('会话已迁移工作区，请恢复到输入框并重新确认文件引用')
  const directories = [...new Set(context.directories.map(canonicalExisting).filter((path): path is string => path !== null))]
  const files = new Set(context.files.map(canonicalExisting).filter((path): path is string => path !== null))
  for (const attachment of entry.draft.attachments) {
    const path = canonicalExisting(attachment.targetPath)
    if (!path || !statSync(path).isFile()) throw new Error(`附件已不存在，请恢复并重新附加：${attachment.filename}`)
    if (!files.has(path) && !directories.some((directory) => contains(directory, path))) throw new Error(`附件授权已变更，请重新附加：${attachment.filename}`)
  }
  // 临时目录只保留当前授权范围内的部分，不能因重试恢复已撤销的授权。
  const additionalDirectories = (entry.input.additionalDirectories ?? []).flatMap((directory) => {
    const path = canonicalExisting(directory)
    return path && directories.some((root) => contains(root, path)) ? [path] : []
  })
  return {
    ...entry.input, workspaceId: context.workspaceId,
    permissionModeOverride: context.permissionMode,
    additionalDirectories, dispatch: 'after_current', interrupt: false, startedAt: Date.now(),
  }
}
