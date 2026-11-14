export const TERMINAL_WORKBENCH_IPC_CHANNELS = {
  PROJECTS_LIST: 'shadowing:terminal:projects:list',
  PROJECTS_PICK: 'shadowing:terminal:projects:pick',
  CREATE: 'shadowing:terminal:create',
  LIST: 'shadowing:terminal:list',
  RESUME: 'shadowing:terminal:resume',
  WRITE: 'shadowing:terminal:write',
  RESIZE: 'shadowing:terminal:resize',
  RENAME: 'shadowing:terminal:rename',
  KILL: 'shadowing:terminal:kill',
  CLEAR_UNREAD: 'shadowing:terminal:clear-unread',
  VISIBLE_PANES: 'shadowing:terminal:visible-panes',
  NOTIFICATIONS_GET: 'shadowing:terminal:notifications:get-enabled',
  NOTIFICATIONS_SET: 'shadowing:terminal:notifications:set-enabled',
  TRANSCRIPT_STATUS: 'shadowing:terminal:transcript:status',
  TRANSCRIPT_CONFIGURE: 'shadowing:terminal:transcript:configure',
  TRANSCRIPT_READ: 'shadowing:terminal:transcript:read',
  DAEMON_STATUS: 'shadowing:terminal:daemon:status',
  DAEMON_UPGRADE: 'shadowing:terminal:daemon:upgrade',
  PICK_FILE: 'shadowing:system:pick-file',
  // Events
  EVENT_DATA: 'shadowing:terminal:data',
  EVENT_EXIT: 'shadowing:terminal:exit',
  EVENT_AGENT_STATE: 'shadowing:terminal:agent-state',
  EVENT_ACTIVATE_SESSION: 'shadowing:terminal:activate-session',
  EVENT_DAEMON_STATUS: 'shadowing:terminal:daemon-status',
} as const

export interface DesktopTerminalProjectDirectory {
  available: boolean
  name: string
  path: string
}

export interface DesktopTerminalSessionInput {
  cols?: number
  cwd?: string | null
  id?: string
  sessionId?: string
  customTitle?: string | null
  rows?: number
  workspaceInstanceId?: string | null
}

export interface DesktopTerminalSessionRecord {
  agentKind?: 'claude-code' | 'codex' | string | null
  agentState?: 'idle' | 'working' | 'waiting' | 'done' | 'error' | null
  agentStateUpdatedAt?: number
  backend: 'pty' | 'pipe' | null
  cols: number
  customTitle?: string | null
  cwd: string | null
  id: string
  output?: string
  outputSequence?: number
  programTitle?: string | null
  ptyPackage?: string | null
  rows: number
  shell: string | null
  status?: 'starting' | 'running' | 'exited' | 'failed'
  token?: string | null
  unread?: boolean
  workspaceInstanceId?: string | null
  exit?: DesktopTerminalExitEvent | { sessionId: string; exitCode: number | null; errorMessage: string | null; signal?: number | string | null }
}

export interface DesktopTerminalDataEvent {
  agentKind?: 'claude-code' | 'codex' | string | null
  agentState?: 'idle' | 'working' | 'waiting' | 'done' | 'error' | null
  agentStateUpdatedAt?: number
  data: string
  sequence?: number
  sessionId: string
  status?: 'starting' | 'running' | 'exited' | 'failed'
  unread?: boolean
}

export interface DesktopTerminalExitEvent {
  exitCode: number
  sessionId: string
  signal?: number | string | null
  errorMessage?: string
  output?: string
  outputSequence?: number
}

export interface DesktopTerminalAgentStateEvent {
  agentKind?: 'claude-code' | 'codex' | string | null
  agentState: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  agentStateUpdatedAt: number
  sessionId: string
  unread?: boolean
}

export interface DesktopTerminalBridge {
  pickFile?: (options?: { title?: string; multiple?: boolean }) => Promise<string | string[] | null>
  rename?: (sessionId: string, title: string | null) => Promise<{ customTitle: string | null }>
  listProjectDirectories?: () => Promise<DesktopTerminalProjectDirectory[]>
  pickProjectDirectory?: () => Promise<DesktopTerminalProjectDirectory | null>
  transcriptStatus?: () => Promise<{ enabled: boolean }>
  configureTranscript?: (enabled: boolean) => Promise<{ enabled: boolean }>
  readTranscript?: (sessionId: string, revision?: string) => Promise<{
    revision: string
    messages: Array<{ id: string; text: string }> | null
  } | null>
  create: (input: DesktopTerminalSessionInput) => Promise<DesktopTerminalSessionRecord>
  kill: (sessionId: string) => Promise<void>
  list: () => Promise<DesktopTerminalSessionRecord[]>
  resume: (input: DesktopTerminalSessionInput) => Promise<DesktopTerminalSessionRecord>
  onData: (listener: (event: DesktopTerminalDataEvent) => void) => () => void
  onExit: (listener: (event: DesktopTerminalExitEvent) => void) => () => void
  clearUnread?: (sessionId: string) => Promise<void>
  reportVisiblePanes?: (payload: { activeSessionId: string | null; visibleSessionIds: string[] }) => Promise<void>
  getNotificationsEnabled?: () => Promise<boolean>
  setNotificationsEnabled?: (enabled: boolean) => Promise<boolean>
  onAgentState?: (listener: (event: DesktopTerminalAgentStateEvent) => void) => () => void
  onActivateSession?: (listener: (event: { sessionId: string }) => void) => () => void
  resize: (sessionId: string, size: { cols: number; rows: number }) => Promise<void>
  write: (sessionId: string, data: string) => Promise<void>
  getDaemonStatus?: () => Promise<{
    connected: boolean
    protocolCompatible: boolean
    daemonAppVersion: string | null
    daemonProtocolVersion: number | null
    activeSessionsCount: number
    waitingSessionsCount: number
    needsUpgrade: boolean
  }>
  upgradeDaemon?: () => Promise<void>
  onDaemonStatus?: (listener: (status: {
    connected: boolean
    protocolCompatible: boolean
    daemonAppVersion: string | null
    daemonProtocolVersion: number | null
    activeSessionsCount: number
    waitingSessionsCount: number
    needsUpgrade: boolean
  }) => void) => () => void
}
