import { buildDesignAgentContextPrompt } from './design-agent-policy'
export { buildDesignAgentContextPrompt } from './design-agent-policy'
import { dirname } from 'node:path'
import type { DesignArtifact } from '@gamma/shared'
import { getDesignBundleSkillPath } from './design-bundle'
import { getAgentSessionMeta } from './agent-session-manager'

const bindings = new Map<string, DesignArtifact>()

export function bindDesignAgentContext(artifact: DesignArtifact): void {
  const session = getAgentSessionMeta(artifact.sessionId)
  if (!session || session.workspaceId !== artifact.workspaceId) throw new Error('设计会话与作品项目不一致')
  bindings.set(artifact.sessionId, artifact)
}

export function unbindDesignAgentContext(artifactId: string): void {
  for (const [sessionId, artifact] of bindings) if (artifact.id === artifactId) bindings.delete(sessionId)
}

export interface DesignAgentContext {
  prompt: string
  additionalDirectories: string[]
}

/** 仅主进程已打开的作品建立上下文，不接受页面提供的模型或凭据。 */
export async function getDesignAgentContext(sessionId: string): Promise<DesignAgentContext | undefined> {
  const artifact = bindings.get(sessionId)
  if (!artifact) return undefined
  const session = getAgentSessionMeta(sessionId)
  if (!session || session.workspaceId !== artifact.workspaceId) {
    bindings.delete(sessionId)
    throw new Error('设计会话的项目归属已改变，请重新打开作品')
  }
  const skillPath = await getDesignBundleSkillPath(artifact.kind)
  return {
    additionalDirectories: [dirname(skillPath)],
    prompt: buildDesignAgentContextPrompt(artifact, skillPath),
  }
}
