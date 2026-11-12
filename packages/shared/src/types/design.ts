/** design 编辑器与 Skill 随应用内置，使用 Gamma 当前会话模型。 */
export const DESIGN_IPC_CHANNELS = {
  GET_STATUS: 'design:get-status',
  INSTALL: 'design:install',
} as const

export const DESIGN_SKILL_SLUG = 'claude-design'
export const DESIGN_SOURCE_URL = 'https://github.com/JimLiu/baoyu-design'
export const DESIGN_SOURCE_REVISION = '7db9784ac4f4974d78ab166c7db1c706c0481c3d'

// 白板使用独立快照，避免升级已有五类编辑器。
export const WHITEBOARD_SOURCE_REVISION = 'e8793e7420d8e8da89cded75a7f2d59132916a52'
export const DESIGN_BUNDLE_REVISION = `${DESIGN_SOURCE_REVISION}-whiteboard-${WHITEBOARD_SOURCE_REVISION}`

export interface DesignIntegrationStatus {
  workspaceId: string
  installed: boolean
  enabled: boolean
  /** 已验证的本地 Skill 根目录，供设计需求准确引用。 */
  skillPath?: string
}

export interface InstallDesignInput {
  workspaceId: string
  /** 兼容旧版安装接口；内置工作台不再调用。 */
  acceptedThirdPartyCode: boolean
}
