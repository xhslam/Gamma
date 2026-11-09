import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { DesignArtifact } from '@gamma/shared'
import { runDesignArtifactCommand, getDesignBundleSkillPath } from './design-bundle'
import { getAgentSessionMeta, isAgentSessionDeleting } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentSessionWorkspacePath } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import { submitAgentMessageOnce } from './agent-send-outbox-service'
import { submitOrEnqueueAgentMessage } from './agent-service'
import { createDesignCommentsBridge, designCommentDigest } from './design-comments-bridge'
import type { DesignCommentsState } from './design-comments-bridge'

/** 去重状态位于 Gamma 私有会话目录，不信任作品目录中的同名文件/符号链接。 */
function statePath(artifact: DesignArtifact): string {
  const workspace = getAgentWorkspace(artifact.workspaceId)
  if (!workspace) throw new Error('作品关联工作区不存在')
  const directory = getAgentSessionWorkspacePath(workspace.slug, artifact.sessionId)
  const key = designCommentDigest({ artifactId: artifact.id, root: artifact.rootPath })
  return join(directory, `.gamma-design-comments-${key}.json`)
}
function loadState(artifact: DesignArtifact): DesignCommentsState {
  const path = statePath(artifact)
  const value = readJsonFileSafe<unknown>(path)
  if (value === null && ![path, `${path}.tmp`, `${path}.bak`].some((candidate) => existsSync(candidate))) return { version: 1, entries: {} }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('entries' in value)
    || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)
    || Object.values(value.entries).some((status) => status !== 'claimed' && status !== 'accepted')) {
    // 无法恢复去重记录时 fail closed，不能把已提交请求当成新评论再次投递。
    throw new Error('作品评论去重状态无效，已停止自动发送')
  }
  return value as DesignCommentsState
}
const bridge = createDesignCommentsBridge<WebContents>({
  run: runDesignArtifactCommand,
  skillPath: getDesignBundleSkillPath,
  session: (id) => isAgentSessionDeleting(id) ? undefined : getAgentSessionMeta(id),
  load: loadState,
  save: (artifact, state) => writeJsonFileAtomic(statePath(artifact), state),
  once: submitAgentMessageOnce,
  submit: submitOrEnqueueAgentMessage,
  warn: (message) => console.warn(`[设计评论] ${message}`),
})

/** 仅消费上游 comments --wait 返回的显式 Send to Agent，不扫描普通评论。 */
export function startDesignComments(artifact: DesignArtifact, webContents: WebContents): void {
  bridge.start(artifact, webContents)
}
export function stopDesignComments(artifactId: string): void { bridge.stop(artifactId) }
export function stopAllDesignComments(): void { bridge.stopAll() }
