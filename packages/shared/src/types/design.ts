/** design 仅接入用户本机的 baoyu-design Skill，不随应用分发上游编辑器。 */
export const DESIGN_IPC_CHANNELS = {
  GET_STATUS: 'design:get-status',
  INSTALL: 'design:install',
} as const

export const DESIGN_SKILL_SLUG = 'claude-design'
export const DESIGN_SOURCE_URL = 'https://github.com/JimLiu/baoyu-design'
export const DESIGN_SOURCE_REVISION = '7db9784ac4f4974d78ab166c7db1c706c0481c3d'

export interface DesignIntegrationStatus {
  workspaceId: string
  installed: boolean
  enabled: boolean
  /** 已验证的本地 Skill 根目录，供设计需求准确引用。 */
  skillPath?: string
}

export interface InstallDesignInput {
  workspaceId: string
  /** UI 必须先展示混合许可和第三方本地代码说明。 */
  acceptedThirdPartyCode: boolean
}
