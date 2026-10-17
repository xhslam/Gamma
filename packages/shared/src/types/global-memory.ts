/** 全局长期记忆条目（Pi Extension 管理的跨会话用户记忆） */
export interface GlobalMemoryEntry {
  /** 相对路径，如 'profile.md' 或 'topics/habits.md' */
  path: string
  /** 文件名或标题 */
  name: string
  /** 描述摘要（提取自 frontmatter description） */
  description?: string
  /** 文件正文完整内容 */
  content: string
  /** 文件版本 Token (sha1 截断 12 位) */
  version: string
  /** 最后修改时间戳 */
  updatedAt: number
  /** 文件大小（字节） */
  size: number
}

export const GLOBAL_MEMORY_IPC_CHANNELS = {
  LIST: 'global-memory:list',
  READ: 'global-memory:read',
  WRITE: 'global-memory:write',
  DELETE: 'global-memory:delete',
} as const
