import { app, BrowserWindow, screen } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@carpus/shared'
import type { AgentWindowChange } from '@carpus/shared'
import { getMainWindow } from './main-window-store'
import { getAgentSessionMeta } from './agent-session-manager'
import { handoffAgentWindow } from './agent-service'
import { getIsQuitting } from './app-lifecycle'

interface TaskWindow {
  window: BrowserWindow
  ready: boolean
}

const windows = new Map<string, TaskWindow>()

export function hasAgentTaskWindows(): boolean {
  return windows.size > 0
}

export function focusAgentTaskWindow(sender: WebContents, sessionId: string): boolean {
  if (sender !== getMainWindow()?.webContents) return false
  const task = windows.get(sessionId)
  if (!task || task.window.isDestroyed()) return false
  if (task.ready) {
    if (task.window.isMinimized()) task.window.restore()
    task.window.show()
    task.window.focus()
  }
  return true
}

export function openAgentTaskWindow(sender: WebContents, sessionId: string, fromDrag: boolean): boolean {
  const main = getMainWindow()
  const source = BrowserWindow.fromWebContents(sender)
  if (typeof sessionId !== 'string' || typeof fromDrag !== 'boolean' || !main || !source) return false
  if (source !== main && (fromDrag || ![...windows.values()].some((task) => task.window === source && task.ready))) return false
  if (windows.has(sessionId)) return focusAgentTaskWindow(sender, sessionId)
  const session = getAgentSessionMeta(sessionId)
  if (!session) return false

  const cursor = screen.getCursorScreenPoint()
  const bounds = source.getBounds()
  if (fromDrag && cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width
    && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height) return false

  const { workArea } = fromDrag ? screen.getDisplayNearestPoint(cursor) : screen.getDisplayMatching(bounds)
  const width = Math.min(1050, workArea.width)
  const height = Math.min(780, workArea.height)
  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)
  const win = new BrowserWindow({
    title: session.title,
    show: false,
    width, height,
    x: clamp(fromDrag ? cursor.x - 80 : bounds.x + 36, workArea.x, workArea.x + workArea.width - width),
    y: clamp(fromDrag ? cursor.y - 32 : bounds.y + 36, workArea.y, workArea.y + workArea.height - height),
    minWidth: Math.min(620, width), minHeight: Math.min(460, height),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const }
      : process.platform === 'win32' ? { titleBarStyle: 'hidden' as const } : {}),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  const task = { window: win, ready: false }
  windows.set(sessionId, task)
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('render-process-gone', () => { if (!win.isDestroyed()) win.close() })

  const timeout = setTimeout(() => { if (!task.ready && !win.isDestroyed()) win.close() }, 20_000)
  win.once('closed', () => {
    clearTimeout(timeout)
    windows.delete(sessionId)
    if (getIsQuitting()) return
    const destination = getMainWindow()
    if (!destination) return
    if (task.ready) handoffAgentWindow(sessionId, destination.webContents, false)
    else if (windows.size > 0 || destination.isVisible()) return
    if (destination.isMinimized()) destination.restore()
    destination.show()
    destination.focus()
  })
  const load = app.isPackaged
    ? win.loadFile(join(__dirname, 'renderer', 'index.html'), { query: { window: 'agent-task' } })
    : win.loadURL('http://127.0.0.1:5173/?window=agent-task')
  void load.catch((error: unknown) => {
    console.error('[Agent 拆窗] 加载窗口失败:', error)
    if (!win.isDestroyed()) win.close()
  })
  return true
}

export function readyAgentTaskWindow(sender: WebContents): void {
  const main = getMainWindow()
  if (!main) return
  for (const [sessionId, task] of windows) {
    if (task.window.webContents !== sender) continue
    handoffAgentWindow(sessionId, sender, true)
    if (!task.ready) {
      task.ready = true
      const change: AgentWindowChange = { type: 'detached', sessionId }
      main.webContents.send(AGENT_IPC_CHANNELS.WINDOW_CHANGED, change)
      task.window.show()
    }
    return
  }
  if (sender === main.webContents) {
    for (const [sessionId, task] of windows) {
      if (task.ready) {
        const change: AgentWindowChange = { type: 'detached', sessionId }
        sender.send(AGENT_IPC_CHANNELS.WINDOW_CHANGED, change)
      }
    }
  }
}
