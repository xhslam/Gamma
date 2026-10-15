/** 会话附件与文件选择公共契约。 */

/** 附件文件大小上限：100MB */
export const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024

/** 文件附件 */
export interface FileAttachment {
  /** 附件唯一标识 */
  id: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** 相对路径: {sessionId}/{uuid}.ext（兼容已有附件目录） */
  localPath: string
  /** 文件大小（字节） */
  size: number
}

/** 保存附件输入 */
export interface AttachmentSaveInput {
  /** 附件所属会话 ID；字段名兼容既有保存接口与磁盘布局。 */
  conversationId: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** base64 编码的文件数据 */
  data: string
}

/** 保存附件结果 */
export interface AttachmentSaveResult {
  /** 保存后的附件信息 */
  attachment: FileAttachment
}

/** 文件选择对话框结果 */
export interface FileDialogResult {
  /** 已读取为 base64 的小文件列表 */
  files: FileDialogFile[]
  /** 超过内存导入上限的大文件，仅返回路径，供 Agent 作为附加文件引用 */
  largeFiles?: FileDialogLargeFile[]
  /** 无法读取或无法识别的文件 */
  skippedFiles?: FileDialogSkippedFile[]
}

export interface FileDialogFile {
  filename: string
  mediaType: string
  data: string
  size: number
}

export interface FileDialogLargeFile {
  filename: string
  mediaType: string
  size: number
  path: string
}

export interface FileDialogSkippedFile {
  filename: string
  mediaType?: string
  size?: number
  path?: string
  reason: 'unreadable'
  message?: string
}

/** Agent Composer 混合选择器中返回的目录；目录只授权访问，不作为消息附件复制。 */
export interface FileDialogDirectory {
  name: string
  path: string
}

/** 支持同时选择文件与文件夹的 Agent Composer 选择结果。 */
export interface FileOrFolderDialogResult extends FileDialogResult {
  directories: FileDialogDirectory[]
}

/** 公共附件 IPC 通道；不注册独立 Chat 服务。 */
export const ATTACHMENT_IPC_CHANNELS = {
  SAVE_ATTACHMENT: 'attachment:save',
  READ_ATTACHMENT: 'attachment:read',
  SAVE_IMAGE_AS: 'attachment:save-image-as',
  SAVE_RESOURCE_FILE_AS: 'attachment:save-resource-file-as',
  DELETE_ATTACHMENT: 'attachment:delete',
  OPEN_FILE_DIALOG: 'attachment:open-file-dialog',
  OPEN_FILE_OR_FOLDER_DIALOG: 'attachment:open-file-or-folder-dialog',
} as const
