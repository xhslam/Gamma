/** 原版 baoyu-design 的五种作品；值不直接用作命令或文件路径。 */
export type DesignArtifactKind = 'slides' | 'canvas' | 'system' | 'dashboard' | 'motion'

export interface DesignArtifact {
  id: string
  workspaceId: string
  sessionId: string
  title: string
  kind: DesignArtifactKind
  rootPath: string
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number
  thumbnailDataUrl?: string
  unavailableReason?: string
  /** 仅为当前运行时的 loopback 地址，不写入作品索引。 */
  editorUrl?: string
}

export interface DesignCreateArtifactInput {
  workspaceId: string
  sessionId: string
  title: string
  kind: DesignArtifactKind
}

export interface DesignOpenArtifactResult {
  artifact: DesignArtifact
  url: string
}
