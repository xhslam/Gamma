import type { DesignThemeSnapshot } from './design-theme'
import type { AgentSessionMeta } from './agent'
import type { BrowserViewState } from './browser'
import type { DesignArtifact, DesignCreateArtifactInput, DesignOpenArtifactResult } from './design-workbench'

export const DESIGN_WORKBENCH_IPC = {
  STATUS: 'design-workbench:status',
  INSTALL: 'design-workbench:install',
  LIST: 'design-workbench:list',
  CREATE: 'design-workbench:create',
  OPEN: 'design-workbench:open',
  CLOSE: 'design-workbench:close',
  THEME: 'design-workbench:theme',
  EXPORT: 'design-workbench:export',
  HANDOFF: 'design-workbench:handoff',
} as const

export interface DesignBundleStatus {
  installed: boolean
  revision: string
  bundlePath?: string
  nodeVersion: string
  supportsSqlite: boolean
}

export interface DesignWorkbenchOpenResult extends DesignOpenArtifactResult {
  browser: BrowserViewState
  session: AgentSessionMeta
}

/** 完整稿保存在关联会话工作台，Agent 可直接读取解包后的文件，不依赖截图或浏览器状态。 */
export interface DesignHandoffResult {
  artifactId: string
  sessionId: string
  title: string
  snapshotPath: string
  archivePath: string
  archiveBytes: number
  fileCount: number
  prompt: string
}

export interface DesignExportResult {
  canceled: boolean
  filePath?: string
}

export interface DesignWorkbenchAPI {
  getDesignBundleStatus: () => Promise<DesignBundleStatus>
  installDesignBundle: (acceptedThirdPartyCode: boolean) => Promise<DesignBundleStatus>
  listDesignArtifacts: (workspaceId: string) => Promise<DesignArtifact[]>
  createDesignArtifact: (input: DesignCreateArtifactInput) => Promise<DesignArtifact>
  openDesignArtifact: (workspaceId: string, artifactId: string, theme?: DesignThemeSnapshot) => Promise<DesignWorkbenchOpenResult>
  updateDesignTheme: (artifactId: string, theme: DesignThemeSnapshot) => Promise<void>
  exportDesignArtifact: (workspaceId: string, artifactId: string) => Promise<DesignExportResult>
  prepareDesignHandoff: (workspaceId: string, artifactId: string) => Promise<DesignHandoffResult>
  closeDesignArtifact: (artifactId: string) => Promise<void>
}
