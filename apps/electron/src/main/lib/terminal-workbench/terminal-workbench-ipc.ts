import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { TERMINAL_WORKBENCH_IPC_CHANNELS, type DesktopTerminalSessionInput } from '@gamma/shared'
import { createTerminalSessionManager } from './terminal-session-manager.cjs'
import { createTerminalProjectDirectories, TERMINAL_FOCUS_SCOPE } from './terminal-project-directories.cjs'
import { createTerminalSessionCatalog } from './terminal-session-catalog.cjs'
import { createTerminalSessionRecoveryStore } from './terminal-session-recovery-store.cjs'
import { createTerminalAgentStatusService } from './terminal-agent-status-service.cjs'
import { createTerminalTranscriptService } from './terminal-transcript-service.cjs'

interface TerminalWorkbenchIpcHost {
  mainWindow: () => BrowserWindow | null
}

let terminalSessionManager: ReturnType<typeof createTerminalSessionManager> | null = null
let terminalSessionCatalog: ReturnType<typeof createTerminalSessionCatalog> | null = null
let terminalProjectDirectories: ReturnType<typeof createTerminalProjectDirectories> | null = null
let terminalTranscriptService: ReturnType<typeof createTerminalTranscriptService> | null = null
let terminalAgentStatusService: ReturnType<typeof createTerminalAgentStatusService> | null = null
let terminalVisibleSessionIds = new Set<string>()
let terminalActiveSessionId: string | null = null

export function registerTerminalWorkbenchIpc(host: TerminalWorkbenchIpcHost): void {
  function sendTerminalEvent(channel: string, payload: unknown) {
    const win = host.mainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  function getProjectDirectories() {
    terminalProjectDirectories ??= createTerminalProjectDirectories(
      path.join(app.getPath('userData'), 'terminal-project-directories.json'),
    )
    return terminalProjectDirectories
  }

  function getRecoveryStore() {
    return createTerminalSessionRecoveryStore(
      path.join(app.getPath('userData'), 'terminal-sessions-recovery.json'),
    )
  }

  function getTranscriptService() {
    terminalTranscriptService ??= createTerminalTranscriptService({
      directory: path.join(app.getPath('userData'), 'terminal-transcripts'),
      homeDirectory: app.getPath('home'),
    })
    return terminalTranscriptService
  }

  function getAgentStatusService() {
    if (!terminalAgentStatusService) {
      terminalAgentStatusService = createTerminalAgentStatusService({
        logger: console.log,
      })
      terminalAgentStatusService.onEvent((event: unknown) => {
        try {
          getSessionManager().handleAgentHookEvent(event)
        } catch (error) {
          console.warn('[terminal-workbench] agent-hook-dispatch-error', error)
        }
      })
    }
    return terminalAgentStatusService
  }

  function getSessionManager() {
    if (terminalSessionManager) return terminalSessionManager

    getAgentStatusService()
    terminalSessionManager = createTerminalSessionManager({
      logger: console.log,
      cwdExistsSync: fs.existsSync,
    })

    terminalSessionManager.onData((payload: unknown) => {
      sendTerminalEvent(TERMINAL_WORKBENCH_IPC_CHANNELS.EVENT_DATA, payload)
    })

    terminalSessionManager.onExit((payload: unknown) => {
      persistRecovery()
      sendTerminalEvent(TERMINAL_WORKBENCH_IPC_CHANNELS.EVENT_EXIT, payload)
    })

    terminalSessionManager.onAgentState((payload: unknown) => {
      sendTerminalEvent(TERMINAL_WORKBENCH_IPC_CHANNELS.EVENT_AGENT_STATE, payload)
    })

    return terminalSessionManager
  }

  function getSessionCatalog() {
    terminalSessionCatalog ??= createTerminalSessionCatalog({
      store: getRecoveryStore(),
      manager: getSessionManager(),
    })
    return terminalSessionCatalog
  }

  function persistRecovery() {
    if (!terminalSessionManager) return []
    try {
      return getSessionCatalog().persist()
    } catch (error) {
      console.warn('[terminal-workbench] recovery-save-failed', error)
      return []
    }
  }

  function requireSessionId(sessionId: unknown): string {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('无效的终端会话 ID。')
    }
    return sessionId.trim()
  }

  // ===== IPC Handlers =====

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.PROJECTS_LIST, async () => {
    return getProjectDirectories().list()
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.PROJECTS_PICK, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '选择终端项目文件夹',
      buttonLabel: '在此文件夹新建终端',
      properties: ['openDirectory' as const],
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths?.[0]) return null
    return getProjectDirectories().grantSelectedDirectory(result.filePaths[0])
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.PICK_FILE, async (event, options?: { multiple?: boolean; title?: string }) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const properties = options?.multiple ? ['openFile' as const, 'multiSelections' as const] : ['openFile' as const]
    const dialogOpts = {
      title: options?.title || '选择要添加到终端的文件',
      buttonLabel: '添加',
      properties,
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts)
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null
    return options?.multiple ? result.filePaths : result.filePaths[0]
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.CREATE, async (_event, input: DesktopTerminalSessionInput) => {
    const manager = getSessionManager()
    const session = manager.createSession({
      ...input,
      workspaceInstanceId: input?.workspaceInstanceId || TERMINAL_FOCUS_SCOPE,
    })
    getSessionCatalog().created(session)
    persistRecovery()
    return session
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.LIST, async () => {
    return getSessionCatalog().list()
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.RESUME, async (_event, input: DesktopTerminalSessionInput) => {
    const id = requireSessionId(input?.id || input?.sessionId)
    const manager = getSessionManager()
    const existing = manager.listSessions().find((session) => session.id === id)
    if (existing) return existing
    const session = manager.createSession({
      ...input,
      id,
      workspaceInstanceId: input?.workspaceInstanceId || TERMINAL_FOCUS_SCOPE,
    })
    getSessionCatalog().created(session)
    persistRecovery()
    return session
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.WRITE, async (_event, sessionId: string, data: string) => {
    const id = requireSessionId(sessionId)
    getSessionManager().write(id, String(data ?? ''))
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.RESIZE, async (_event, sessionId: string, size: { cols: number; rows: number }) => {
    const id = requireSessionId(sessionId)
    getSessionManager().resize(id, {
      cols: Number(size?.cols) || 80,
      rows: Number(size?.rows) || 24,
    })
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.RENAME, async (_event, sessionId: string, title: string | null) => {
    const id = requireSessionId(sessionId)
    const catalog = getSessionCatalog()
    const record = catalog.list().find((item) => item.id === id) ?? getSessionManager().getEndedSession(id)
    if (!record || record.workspaceInstanceId !== TERMINAL_FOCUS_SCOPE) {
      throw new Error('此终端会话不支持重命名。')
    }
    const previousTitle = catalog.withTitle(record).customTitle ?? null
    const customTitle = catalog.rename(id, title)
    try {
      catalog.persist()
    } catch (error) {
      catalog.rename(id, previousTitle)
      throw error
    }
    return { customTitle }
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.KILL, async (_event, sessionId: string) => {
    const id = requireSessionId(sessionId)
    if (getSessionManager().listSessions().some((record) => record.id === id)) {
      getSessionManager().kill(id)
    } else {
      getSessionCatalog().remove(id)
    }
    persistRecovery()
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.CLEAR_UNREAD, async (_event, sessionId: string) => {
    const id = requireSessionId(sessionId)
    getSessionManager().clearUnread(id)
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.VISIBLE_PANES, async (_event, payload?: { activeSessionId?: unknown; visibleSessionIds?: unknown }) => {
    terminalActiveSessionId = typeof payload?.activeSessionId === 'string' ? payload.activeSessionId : null
    terminalVisibleSessionIds = new Set(
      Array.isArray(payload?.visibleSessionIds)
        ? payload.visibleSessionIds.filter((id: unknown) => typeof id === 'string')
        : []
    )
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.NOTIFICATIONS_GET, async () => {
    return true
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.NOTIFICATIONS_SET, async (_event, enabled: boolean) => {
    return enabled !== false
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.TRANSCRIPT_STATUS, async () => {
    return { enabled: getTranscriptService().isEnabled() }
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.TRANSCRIPT_CONFIGURE, async (_event, enabled: boolean) => {
    return getTranscriptService().configure(enabled)
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.TRANSCRIPT_READ, async (_event, sessionId: string, revision?: string) => {
    const id = requireSessionId(sessionId)
    return getTranscriptService().read(id, revision)
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.DAEMON_STATUS, async () => {
    return {
      connected: true,
      protocolCompatible: true,
      daemonAppVersion: app.getVersion(),
      daemonProtocolVersion: 1,
      activeSessionsCount: getSessionManager().listSessions().length,
      waitingSessionsCount: 0,
      needsUpgrade: false,
    }
  })

  ipcMain.handle(TERMINAL_WORKBENCH_IPC_CHANNELS.DAEMON_UPGRADE, async () => {
    // In-process manager doesn't need external upgrade
  })
}
