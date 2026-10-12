import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@gamma/shared'
import type { MarkdownWorkspaceContext, MarkdownWorkspaceRequest, MarkdownWorkspaceResult } from '@gamma/shared'
import { MarkdownWorkspaceService } from './markdown-workspace-service'
import { resolveMarkdownRelativeMediaPath } from './markdown-media-service'

interface MarkdownIpcHost {
  mainWindow: () => BrowserWindow | null
  /** 核验 workspace/session 存在、所属关系；失败时抛错。 */
  projectPath: (context: MarkdownWorkspaceContext) => string | undefined
  mediaUrl: (path: string) => string
}
export function registerMarkdownWorkspaceIpc(host: MarkdownIpcHost): void {
  const service = new MarkdownWorkspaceService()
  const observed = new Set<number>()
  ipcMain.handle(IPC_CHANNELS.MARKDOWN_WORKSPACE, async (event, input: MarkdownWorkspaceRequest): Promise<MarkdownWorkspaceResult> => {
    try {
      const window = host.mainWindow()
      if (!window || window.webContents.id !== event.sender.id) throw new Error('仅主窗口可以打开 Markdown 工作区。')
      if (!input || typeof input !== 'object' || typeof input.action !== 'string') throw new Error('无效请求。')
      if ((input.workspaceId !== undefined && typeof input.workspaceId !== 'string') || (input.sessionId !== undefined && typeof input.sessionId !== 'string')) throw new Error('无效工作区身份。')
      const project = host.projectPath(input)
      const scopeKey = input.workspaceId || 'global'
      const owner = JSON.stringify([event.sender.id, input.workspaceId ?? '', input.sessionId ?? ''])
      service.synchronizeProject(owner, project)
      if (!observed.has(event.sender.id)) {
        observed.add(event.sender.id)
        event.sender.once('destroyed', () => { service.disposeOwner(`[${event.sender.id},`); observed.delete(event.sender.id) })
      }
      switch (input.action) {
        case 'restore': return service.restore(owner, scopeKey, project)
        case 'create': return service.createFile(owner, input.sourceId, input.path, input.name)
        case 'choose': {
          if (input.kind !== 'file' && input.kind !== 'directory') throw new Error('无效来源类型。')
          const selected = await dialog.showOpenDialog(window, {
            title: input.kind === 'file' ? '打开 Markdown 文件' : '打开 Markdown 目录',
            properties: [input.kind === 'file' ? 'openFile' : 'openDirectory'],
            ...(input.kind === 'file' ? { filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] } : {}),
          })
          host.projectPath(input) // dialog 返回前项目可能已切换/删除，重新核验身份。
          const path = selected.filePaths[0]
          return selected.canceled || !path ? { status: 'cancelled' } : { status: 'source', source: service.grant(owner, path, input.kind, 'dialog', scopeKey) }
        }
        case 'project': return project ? { status: 'source', source: service.grant(owner, project, 'directory', 'project', scopeKey) } : { status: 'error', code: 'missing', message: '当前没有可用项目，请选择文件或目录。' }
        case 'list': return service.list(owner, input.sourceId, input.path)
        case 'read': return service.read(owner, input.sourceId, input.path)
        case 'save': return service.save(owner, input.documentId, input.content, input.expectedRevision)
        case 'save-as': {
          if (!input.documentId.startsWith('untitled:')) service.authorizedDocumentPath(owner, input.documentId)
          const selected = await dialog.showSaveDialog(window, { title: 'Markdown 另存为', filters: [{ name: 'Markdown', extensions: ['md'] }], properties: ['showOverwriteConfirmation'] })
          host.projectPath(input)
          return selected.canceled || !selected.filePath ? { status: 'cancelled' } : service.saveAs(owner, input.documentId, input.content, selected.filePath)
        }
        case 'media': {
          const path = service.authorizedDocumentPath(owner, input.documentId)
          const media = resolveMarkdownRelativeMediaPath(path, input.src)
          return { status: 'media', url: media ? host.mediaUrl(media) : null }
        }
        case 'release': return service.release(owner, input.sourceId, scopeKey)
        default: throw new Error('未知操作。')
      }
    } catch {
      return { status: 'error', code: 'denied', message: '请求未获授权或来源已失效，请重新打开文件。' }
    }
  })
}
