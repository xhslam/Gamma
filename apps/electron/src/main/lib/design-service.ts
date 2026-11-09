import { DESIGN_SKILL_SLUG } from '@gamma/shared'
import type { DesignIntegrationStatus, InstallDesignInput } from '@gamma/shared'
import { getAgentWorkspace, getAllWorkspaceSkills, getWorkspaceSkillFolder } from './agent-workspace-manager'
import { getInactiveSkillsDir, getWorkspaceSkillsDir } from './config-paths'
import { installDesignSkill } from './design-skill-install'

const installations = new Map<string, Promise<DesignIntegrationStatus>>()

function requireWorkspace(workspaceId: string) {
  if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('请先选择项目')
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) throw new Error('项目不存在')
  return workspace
}

export function getDesignStatus(workspaceId: string): DesignIntegrationStatus {
  const workspace = requireWorkspace(workspaceId)
  const skill = getAllWorkspaceSkills(workspace.slug).find((item) => item.slug === DESIGN_SKILL_SLUG)
  return {
    workspaceId,
    installed: Boolean(skill),
    enabled: skill?.enabled === true,
    skillPath: skill?.enabled ? getWorkspaceSkillFolder(workspace.slug, DESIGN_SKILL_SLUG) : undefined,
  }
}

export async function installWorkspaceDesign(input: InstallDesignInput): Promise<DesignIntegrationStatus> {
  if (!input || input.acceptedThirdPartyCode !== true) throw new Error('请先确认上游混合许可与第三方本地代码说明')
  const workspace = requireWorkspace(input.workspaceId)
  const pending = installations.get(workspace.id)
  if (pending) return pending
  const status = getDesignStatus(workspace.id)
  if (status.installed) return status
  const operation = (async () => {
    await installDesignSkill({
      skillsDirectory: getWorkspaceSkillsDir(workspace.slug),
      inactiveSkillsDirectory: getInactiveSkillsDir(workspace.slug),
    })
    return getDesignStatus(workspace.id)
  })()
  installations.set(workspace.id, operation)
  try { return await operation } finally { installations.delete(workspace.id) }
}
