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

export interface DesignWorkbenchAPI {
  getDesignBundleStatus: () => Promise<DesignBundleStatus>
  installDesignBundle: (acceptedThirdPartyCode: boolean) => Promise<DesignBundleStatus>
  listDesignArtifacts: (workspaceId: string) => Promise<DesignArtifact[]>
  createDesignArtifact: (input: DesignCreateArtifactInput) => Promise<DesignArtifact>
  openDesignArtifact: (workspaceId: string, artifactId: string, theme?: DesignThemeSnapshot) => Promise<DesignWorkbenchOpenResult>
  updateDesignTheme: (artifactId: string, theme: DesignThemeSnapshot) => Promise<void>
  closeDesignArtifact: (artifactId: string) => Promise<void>
}
