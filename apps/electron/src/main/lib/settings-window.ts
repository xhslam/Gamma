import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { getIsQuitting } from './app-lifecycle'
import { isSettingsTab, SETTINGS_IPC_CHANNELS } from '../../types/settings'
import type { SettingsTab } from '../../types/settings'

let current: { window: BrowserWindow; owner: BrowserWindow; tab: SettingsTab; ready: boolean } | undefined

export async function openSettingsWindow(sender: Electron.WebContents, tab: unknown, navigate: boolean): Promise<void> {
  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner || !isSettingsTab(tab)) throw new Error('无效的设置窗口请求')
  if (current && !current.window.isDestroyed()) {
    const { window, ready } = current
    if (navigate) current.tab = tab
    if (ready) {
      if (navigate) window.webContents.send(SETTINGS_IPC_CHANNELS.WINDOW_NAVIGATE, tab)
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    return
  }

  const { workArea } = screen.getDisplayMatching(owner.getBounds())
  const width = Math.min(760, workArea.width)
  const height = Math.min(680, workArea.height)
  const window = new BrowserWindow({
    parent: owner,
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    minWidth: Math.min(600, width),
    minHeight: Math.min(400, height),
    useContentSize: true,
    show: false,
    title: '设置',
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: 14 },
    }),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const entry = { window, owner, tab, ready: false }
  current = entry
  const openExternal = (url: string): void => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  }
  window.webContents.on('will-navigate', (event, url) => {
    if (!app.isPackaged && new URL(url).origin === 'http://127.0.0.1:5173') return
    event.preventDefault()
    openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  window.on('close', (event) => {
    if (!entry.ready || getIsQuitting()) return
    event.preventDefault()
    window.webContents.send(SETTINGS_IPC_CHANNELS.WINDOW_CLOSE_REQUESTED)
  })
  window.on('closed', () => {
    if (current === entry) current = undefined
    if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
      owner.webContents.send(SETTINGS_IPC_CHANNELS.WINDOW_CLOSED, entry.tab)
    }
  })
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) window.destroy()
  })
  const query = { window: 'settings', tab }
  try {
    if (app.isPackaged) {
      await window.loadFile(join(__dirname, 'renderer', 'index.html'), { query })
    } else {
      await window.loadURL(`http://127.0.0.1:5173?${new URLSearchParams(query)}`)
    }
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}

export function readySettingsWindow(sender: Electron.WebContents): SettingsTab | null {
  if (!current || current.window.isDestroyed() || current.window.webContents !== sender) return null
  const { window, tab } = current
  if (!current.ready) {
    current.ready = true
    window.show()
  }
  return tab
}

export function closeSettingsWindow(sender: Electron.WebContents, tab: unknown): void {
  if (!current || current.window.isDestroyed() || current.window.webContents !== sender) return
  if (isSettingsTab(tab)) current.tab = tab
  current.window.destroy()
}
