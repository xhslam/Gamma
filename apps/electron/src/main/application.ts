import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, screen, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'

// bootstrap 完成品牌迁移后才会载入本模块，服务不会读取半迁移的数据。
app.on('second-instance', () => showAndFocusMainWindow())

import { getSettings, updateSettings } from './lib/settings-service'
import { restoreAppIconVariant } from './lib/app-icon-service'
import { handleGammaFileRequest } from './lib/local-file-protocol'

// 处理 EPIPE/EIO 错误：当 stdout/stderr 管道或终端 pty 被关闭时，忽略写入错误
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') return
  throw err
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') return
  throw err
})


// 清理本地环境中的 ANTHROPIC_* 变量，防止干扰应用的认证流程
// Electron 桌面应用通过渠道系统管理 API Key，不应受终端环境变量影响
// 注意：此操作必须在 initializeRuntime()（loadShellEnv）之前执行
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ANTHROPIC_')) {
    delete process.env[key]
  }
}

import { createApplicationMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, destroyTray, getTray, setTrayFlash } from './tray'
import { initializeRuntime } from './lib/runtime-init'
import { seedDefaultSkills } from './lib/config-paths'
import { upgradeDefaultSkillsInWorkspaces } from './lib/agent-workspace-manager'
import { hasActiveAgentSessions, stopAllAgents } from './lib/agent-service'
import { stopAllTerminals } from './lib/terminal-service'
import { disposePiMcpConnections } from './lib/adapters/pi-mcp-tools'
import { browserController } from './lib/browser-controller'
import { computerController } from './lib/computer-service'
import { markRunningDelegationsAsInterrupted } from './lib/agent-session-manager'
import { configureUpdater, initAutoUpdater, cleanupUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { getIsQuitting, setQuitting } from './lib/app-lifecycle'
import { getMainWindow as getStoredMainWindow, setMainWindow as setStoredMainWindow } from './lib/main-window-store'
import {
  registerBridge,
  startAllBridges,
  startBridgeSelfHealing,
  stopAllBridges,
  stopBridgeSelfHealing,
} from './lib/bridge-registry'
import { startScheduler, stopScheduler } from './lib/automation-scheduler'
import { startPlanningReminderScheduler, stopPlanningReminderScheduler } from './lib/planning-reminder-scheduler'
import { startPlanningNativeSyncCoordinator, stopPlanningNativeSyncCoordinator } from './lib/planning-native-sync-coordinator'
import { feishuBridgeManager } from './lib/feishu-bridge-manager'
import { getFeishuMultiBotConfig } from './lib/feishu-config'
import { stopFeishuSyncSleepBlocker, syncFeishuSyncSleepBlocker } from './lib/feishu-sleep-blocker'
import {
  ensureWindowBoundsVisible,
  getPersistableMainWindowState,
  hideMacMainWindowAfterClose,
  normalizeWindowBoundsToVisibleArea,
  type WindowBounds,
} from './lib/main-window-lifecycle'
import { dingtalkBridgeManager } from './lib/dingtalk-bridge-manager'
import { getDingTalkMultiBotConfig } from './lib/dingtalk-config'
import { redactSensitiveLogValue } from './lib/bridge-log-redaction'
import { slackBridgeManager } from './lib/slack-bridge-manager'
import { getSlackConfig } from './lib/slack-config'
import { wechatBridge } from './lib/wechat-bridge'
import { getWeChatConfig } from './lib/wechat-config'
import { createQuickTaskWindow, toggleQuickTaskWindow, destroyQuickTaskWindow } from './lib/quick-task-window'
import { getAgentStatusHoverWindow, destroyAgentStatusHoverWindow } from './agent-status-hover-window'
import { handleNativeAgentIslandEvent, initAgentIslandService, disposeAgentIslandService, publishAgentIslandNow } from './lib/agent-island-service'
import { disposeMacAgentIslandNativeHost, startMacAgentIslandNativeHost, isMacAgentIslandNativeHostReady } from './lib/mac-agent-island-native-host'
import { isAgentIslandServiceSupported, isMacAgentIslandSurfaceSupported } from './lib/macos-version'
import { getWindowsAgentIslandSurface, processNotification, type SurfaceDeps } from './lib/windows-agent-island-surface'
import {
  createVoiceDictationWindow,
  toggleVoiceDictationWindow,
  destroyVoiceDictationWindow,
  shouldSuppressVoiceDictationActivate,
} from './lib/voice-dictation-window'
import { registerGlobalShortcut, unregisterAllGlobalShortcuts } from './lib/global-shortcut-service'
import { setGammaVersion } from '@gamma/core'
import { canRecoverRenderer, RENDERER_RECOVERY_WINDOW_MS } from './lib/renderer-process-recovery'
import { TRAY_IPC_CHANNELS, WINDOWS_AGENT_ISLAND_IPC_CHANNELS } from '../types'

/** macOS 26+ 使用 Swift/AppKit NSPanel；其他平台不创建 Agent Island surface。 */
function startAgentIslandSurface(): void {
  if (!isMacAgentIslandSurfaceSupported()) {
    console.info('[agent-island] 当前平台或 macOS 版本不支持，已禁用')
    return
  }

  const startedNative = startMacAgentIslandNativeHost({
    onReady: () => {
      console.info('[agent-island] macOS 原生 NSPanel helper 已就绪')
      publishAgentIslandNow()
    },
    onEvent: handleNativeAgentIslandEvent,
    onUnavailable: (reason) => {
      console.warn(`[agent-island] macOS 原生 helper 不可用，已禁用：${reason}`)
    },
  })
  if (!startedNative) {
    console.warn('[agent-island] macOS 原生 helper 启动失败，已禁用')
  }
}

// ===== Bridge 注册（新增 Bridge 只需在此添加一个 registerBridge 调用） =====

registerBridge({
  name: '飞书 BridgeManager',
  shouldAutoStart: () => {
    const config = getFeishuMultiBotConfig()
    return config.bots.some((b) => b.enabled && b.appId && b.appSecret)
  },
  needsRecovery: () => {
    const config = getFeishuMultiBotConfig()
    const states = feishuBridgeManager.getStates()
    return config.bots.some((bot) => (
      bot.enabled &&
      !!bot.appId &&
      !!bot.appSecret &&
      states.bots[bot.id]?.status === 'error'
    ))
  },
  start: () => feishuBridgeManager.startAll(),
  stop: () => feishuBridgeManager.stopAll(),
  recover: () => recoverEnabledFeishuBots(),
})

registerBridge({
  name: '钉钉 BridgeManager',
  shouldAutoStart: () => {
    const config = getDingTalkMultiBotConfig()
    return config.bots.some((b) => b.enabled && b.clientId && b.clientSecret)
  },
  needsRecovery: () => {
    const config = getDingTalkMultiBotConfig()
    const states = dingtalkBridgeManager.getStates()
    return config.bots.some((bot) => (
      bot.enabled &&
      !!bot.clientId &&
      !!bot.clientSecret &&
      states.bots[bot.id]?.status === 'error'
    ))
  },
  start: () => dingtalkBridgeManager.startAll(),
  stop: () => dingtalkBridgeManager.stopAll(),
  recover: () => recoverEnabledDingTalkBots(),
})

registerBridge({
  name: 'Slack BridgeManager',
  shouldAutoStart: () => {
    const config = getSlackConfig()
    return config.bots.some((bot) => bot.enabled && bot.botToken && bot.appToken)
  },
  needsRecovery: () => {
    const config = getSlackConfig()
    const states = slackBridgeManager.getStates()
    return config.bots.some((bot) => (
      bot.enabled && !!bot.botToken && !!bot.appToken && states.bots[bot.id]?.status === 'error'
    ))
  },
  start: () => slackBridgeManager.startAll(),
  stop: () => slackBridgeManager.stopAll(),
  recover: () => recoverEnabledSlackBots(),
})

registerBridge({
  name: '微信 Bridge',
  shouldAutoStart: () => {
    const config = getWeChatConfig()
    return !!(config.enabled && config.credentials)
  },
  needsRecovery: () => wechatBridge.getStatus().status === 'error',
  start: () => wechatBridge.start(),
  stop: () => wechatBridge.stop(),
})

async function recoverEnabledFeishuBots(): Promise<void> {
  const config = getFeishuMultiBotConfig()
  let failedCount = 0
  for (const bot of config.bots) {
    if (!bot.enabled || !bot.appId || !bot.appSecret) continue
    try {
      await feishuBridgeManager.restartBot(bot.id)
    } catch (error) {
      failedCount++
      console.error(`[飞书 BridgeManager] Bot "${bot.name}" 自愈恢复失败:`, error)
    }
  }
  if (failedCount > 0) {
    throw new Error(`${failedCount} 个飞书 Bot 自愈恢复失败`)
  }
}

async function recoverEnabledDingTalkBots(): Promise<void> {
  const config = getDingTalkMultiBotConfig()
  let failedCount = 0
  for (const bot of config.bots) {
    if (!bot.enabled || !bot.clientId || !bot.clientSecret) continue
    try {
      await dingtalkBridgeManager.restartBot(bot.id)
    } catch (error) {
      failedCount++
      console.error(`[钉钉 BridgeManager] Bot "${bot.name}" 自愈恢复失败:`, error)
    }
  }
  if (failedCount > 0) {
    throw new Error(`${failedCount} 个钉钉 Bot 自愈恢复失败`)
  }
}

async function recoverEnabledSlackBots(): Promise<void> {
  const config = getSlackConfig()
  let failedCount = 0
  for (const bot of config.bots) {
    if (!bot.enabled || !bot.botToken || !bot.appToken) continue
    try {
      await slackBridgeManager.restartBot(bot.id)
    } catch (error) {
      failedCount++
      console.error(`[Slack BridgeManager] Bot "${bot.name}" 自愈恢复失败:`, redactSensitiveLogValue(error))
    }
  }
  if (failedCount > 0) {
    throw new Error(`${failedCount} 个 Slack Bot 自愈恢复失败`)
  }
}

let mainWindow: BrowserWindow | null = null

const DEFAULT_MAIN_WINDOW_WIDTH = 1400
const DEFAULT_MAIN_WINDOW_HEIGHT = 900
const MIN_MAIN_WINDOW_WIDTH = 800
const MIN_MAIN_WINDOW_HEIGHT = 600

function getVisibleMainWindowBounds(bounds: WindowBounds): WindowBounds {
  return normalizeWindowBoundsToVisibleArea(
    bounds,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
    {
      minWidth: MIN_MAIN_WINDOW_WIDTH,
      minHeight: MIN_MAIN_WINDOW_HEIGHT,
      fallbackWidth: DEFAULT_MAIN_WINDOW_WIDTH,
      fallbackHeight: DEFAULT_MAIN_WINDOW_HEIGHT,
    },
  )
}

function getInitialMainWindowBounds(
  savedState: ReturnType<typeof getSettings>['mainWindowState'],
): Partial<WindowBounds> {
  if (!savedState) {
    return { width: DEFAULT_MAIN_WINDOW_WIDTH, height: DEFAULT_MAIN_WINDOW_HEIGHT }
  }

  return getVisibleMainWindowBounds(savedState)
}

/** 获取主窗口实例（供其他模块使用） */
export function getMainWindow(): BrowserWindow | null {
  return getStoredMainWindow()
}

function installWindowsZoomInFallback(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return

    // Windows 下主键盘的 Ctrl++ 常会以 Ctrl+= 上报；小键盘加号也需要兜底。
    const key = input.key.toLowerCase()
    if (!['=', '+', 'numadd', 'add'].includes(key)) return

    event.preventDefault()
    const currentZoomLevel = win.webContents.getZoomLevel()
    win.webContents.setZoomLevel(Math.min(currentZoomLevel + 0.5, 9))
  })
}

/**
 * 检查窗口是否在可用显示器范围内
 * 处理外接显示器断开后窗口位于不可见区域的情况
 */
function ensureWindowOnScreen(win: BrowserWindow): void {
  const repositioned = ensureWindowBoundsVisible(
    win,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
    {
      minWidth: MIN_MAIN_WINDOW_WIDTH,
      minHeight: MIN_MAIN_WINDOW_HEIGHT,
      fallbackWidth: DEFAULT_MAIN_WINDOW_WIDTH,
      fallbackHeight: DEFAULT_MAIN_WINDOW_HEIGHT,
    },
  )
  if (repositioned) console.log('[窗口] 窗口已重新定位到主显示器可见区域')
}

/** 显示并聚焦主窗口，确保窗口在可见区域；若窗口已销毁则重新创建 */
function showAndFocusMainWindow(): void {
  if (process.platform === 'darwin') {
    if (app.dock) app.dock.show()
    app.show()
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  ensureWindowOnScreen(mainWindow)
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Get the appropriate app icon path for the current platform
 */
function getIconPath(): string {
  // resources 在 build:resources 阶段被复制到 dist/ 下，与 main.cjs 同级
  const resourcesDir = join(__dirname, 'resources')

  if (process.platform === 'darwin') {
    return join(resourcesDir, 'icon.icns')
  } else if (process.platform === 'win32') {
    return join(resourcesDir, 'icon.ico')
  } else {
    return join(resourcesDir, 'icon.png')
  }
}

function saveMainWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const mainWindowState = getPersistableMainWindowState(mainWindow)
  if (!mainWindowState) return
  updateSettings({
    mainWindowState,
  })
}

function isDevServerNavigation(url: string): boolean {
  try {
    return new URL(url).origin === 'http://127.0.0.1:5173'
  } catch {
    return false
  }
}

function createWindow(): void {
  const iconPath = getIconPath()
  const iconExists = existsSync(iconPath)

  if (!iconExists) {
    console.warn('App icon not found at:', iconPath)
  }

  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'

  const titleBarOptions = isMac
    ? {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 18, y: 18 },
        vibrancy: 'under-window' as const,
        visualEffectState: 'followWindow' as const,
      }
    : isWindows
      ? { titleBarStyle: 'hidden' as const }
      : {}

  const savedState = getSettings().mainWindowState
  const initialBounds = getInitialMainWindowBounds(savedState)

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_MAIN_WINDOW_WIDTH,
    minHeight: MIN_MAIN_WINDOW_HEIGHT,
    icon: iconExists ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 实验：恢复 Chromium 的后台调度节流，避免隐藏窗口的 renderer 持续占用主线程。
      // 当前排队消息自动投递仍由 renderer 消费 STREAM_COMPLETE；隐藏窗口下可能延后，
      // 这是本分支需要与卡顿改善一起验证的行为代价。
      backgroundThrottling: true,
    },
    ...titleBarOptions,
  })
  setStoredMainWindow(mainWindow)
  installWindowsZoomInFallback(mainWindow)
  browserController.setOwnerWindow(mainWindow)

  // Load the renderer
  const isDev = !app.isPackaged
  const rendererPath = join(__dirname, 'renderer', 'index.html')
  const rendererEntryUrl = isDev ? 'http://127.0.0.1:5173' : pathToFileURL(rendererPath).toString()
  const loadMainRenderer = (): Promise<void> => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return Promise.reject(new Error('主窗口已销毁'))
    }
    return isDev
      ? mainWindow.loadURL(rendererEntryUrl)
      : mainWindow.loadFile(rendererPath)
  }

  // 主 Renderer 无法加载或崩溃时，优先有限次数自动恢复，再显示可重试的错误页。
  let hasShownRendererFailure = false
  let rendererRecoveryAttempts: number[] = []
  const showRendererFailure = (reason: string): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    if (hasShownRendererFailure) {
      mainWindow.show()
      return
    }

    hasShownRendererFailure = true
    const escapeHtml = (value: string): string => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>Gamma 无法加载</title><style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:48px;color:#222;background:#fff}main{max-width:680px;margin:auto}h1{font-size:20px;font-weight:600}pre{white-space:pre-wrap;background:#f3f3f3;padding:16px;border-radius:8px}a{display:inline-block;margin-top:12px;padding:9px 14px;border-radius:6px;background:#222;color:#fff;text-decoration:none}</style></head><body><main><h1>Gamma 无法加载主界面</h1><pre>${escapeHtml(reason)}</pre><a href="${escapeHtml(rendererEntryUrl)}">重新加载主界面</a></main></body></html>`
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`).catch((error) => {
      console.error('[启动] 降级错误页加载失败:', error)
      mainWindow?.show()
    })
  }
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    console.error(`[启动] 主 Renderer 加载失败 (${errorCode}): ${errorDescription} (${validatedURL})`)
    showRendererFailure(errorDescription)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    // 主 Renderer 成功恢复后重新开始计数；只有连续失败才应进入错误页。
    if (!hasShownRendererFailure) rendererRecoveryAttempts = []
  })
  mainWindow.on('hide', () => { void computerController.stop('主窗口已隐藏') })
  mainWindow.on('close', () => { void computerController.stop('主窗口已关闭') })
  mainWindow.webContents.on('destroyed', () => { void computerController.stop('主页面已销毁') })
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) void computerController.stop('主页面导航或重载')
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void computerController.stop('主页面失联')
    // clean-exit 和应用退出不属于 Renderer 故障；避免退出过程中重新加载主窗口。
    if (getIsQuitting() || details.reason === 'clean-exit') return

    const now = Date.now()
    rendererRecoveryAttempts = rendererRecoveryAttempts.filter(
      (attemptAt) => now - attemptAt < RENDERER_RECOVERY_WINDOW_MS,
    )
    const processId = (() => {
      try {
        return mainWindow?.webContents.getProcessId()
      } catch {
        return undefined
      }
    })()
    const rendererUrl = (() => {
      try {
        return mainWindow?.webContents.getURL()
      } catch {
        return undefined
      }
    })()
    const crashContext = {
      reason: details.reason,
      exitCode: details.exitCode,
      url: rendererUrl,
      processId,
    }
    console.error('[启动] 主 Renderer 进程异常退出:', crashContext)

    if (!hasShownRendererFailure && canRecoverRenderer(rendererRecoveryAttempts, now)) {
      rendererRecoveryAttempts.push(now)
      console.warn(`[启动] 尝试恢复主 Renderer（${rendererRecoveryAttempts.length}/2）`)
      void loadMainRenderer().catch((error) => {
        console.error('[启动] 主 Renderer 自动恢复失败:', error)
        showRendererFailure(`Renderer 进程异常退出：${details.reason}`)
      })
      return
    }

    showRendererFailure(`Renderer 进程异常退出：${details.reason}\n退出码：${details.exitCode}`)
  })

  // 窗口就绪后，按保存的状态决定是否最大化
  mainWindow.once('ready-to-show', () => {
    if (savedState?.isMaximized ?? true) {
      mainWindow?.maximize()
    }
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show()
    }
    // 等主窗口首帧完成合成后直接显示工作区，避免提前显示空白窗口。
    mainWindow?.show()
  })

  // 持久化窗口大小和位置（防抖 500ms，避免频繁写入）
  let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleWindowStateSave = (): void => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null
      saveMainWindowState()
    }, 500)
  }
  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('move', scheduleWindowStateSave)

  // 拦截页面内导航，外部链接用系统浏览器打开，防止 Electron 窗口被覆盖
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 错误页上的“重新加载主界面”需要放行回到原始入口。
    if (url === rendererEntryUrl) {
      hasShownRendererFailure = false
      rendererRecoveryAttempts = []
      return
    }
    // 允许开发模式下的 Vite HMR 热重载
    if (isDev && isDevServerNavigation(url)) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  // 拦截 window.open / target="_blank" 链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) mainWindow.webContents.openDevTools()
  void loadMainRenderer().catch((error) => {
    console.error('[启动] 主 Renderer 初始加载失败:', error)
    showRendererFailure(error instanceof Error ? error.message : String(error))
  })

  // macOS: 点击关闭按钮时隐藏窗口+应用，而不是退出
  // 同时隐藏应用（类似 Cmd+H），确保点击 Dock 图标时 macOS 能正确触发 activate 事件
  if (process.platform === 'darwin') {
    mainWindow.on('close', (event) => {
      if (!getIsQuitting()) {
        // 隐藏前先刷新挂起的窗口状态保存
        if (windowStateSaveTimer) {
          clearTimeout(windowStateSaveTimer)
          windowStateSaveTimer = null
        }
        saveMainWindowState()
        event.preventDefault()
        if (mainWindow && !mainWindow.isDestroyed()) {
          hideMacMainWindowAfterClose(mainWindow, app)
        }
      }
    })
  }

  // Windows: 点击关闭按钮时隐藏窗口到托盘，而不是退出
  if (process.platform === 'win32') {
    mainWindow.on('close', (event) => {
      if (!getIsQuitting() && getTray()) {
        // 隐藏前先刷新挂起的窗口状态保存
        if (windowStateSaveTimer) {
          clearTimeout(windowStateSaveTimer)
          windowStateSaveTimer = null
        }
        saveMainWindowState()
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  }

  mainWindow.on('closed', () => {
    setStoredMainWindow(null)
    browserController.dispose()
    mainWindow = null
  })
}

function sendToMainWindow(channel: string, data?: unknown): void {
  showAndFocusMainWindow()

  const win = mainWindow
  if (!win || win.isDestroyed()) return

  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

app.whenReady().then(bootstrap).catch(handleBootstrapFailure)

/**
 * 启动主流程。所有非关键步骤用 safeRun / safeAwait 隔离，
 * 单点失败不应阻止窗口和托盘的创建（用户至少要能看到界面）。
 */
async function bootstrap(): Promise<void> {
  // 初始化 Gamma 版本号（供 User-Agent 等全局标识使用）
  setGammaVersion(app.getVersion())

  // 注册自定义协议 gamma-file:// 用于内联预览本地文件。
  // 协议只接受主进程签发的 opaque token，不解析 renderer 提供的绝对路径。
  protocol.handle('gamma-file', handleGammaFileRequest)

  // 初始化运行时环境。Node.js 仅由 npx / npm 型 MCP 在实际连接时使用，
  // 或由用户从设置手动检测；启动时不应将其作为 Agent 的前置要求。
  await safeAwait('initializeRuntime', () => initializeRuntime({ skipNodeDetection: true }))

  // 同步默认 Skills 模板到 ~/.gamma/default-skills/
  safeRun('seedDefaultSkills', seedDefaultSkills)

  // 升级所有工作区中版本过旧的默认 Skills
  safeRun('upgradeDefaultSkillsInWorkspaces', upgradeDefaultSkillsInWorkspaces)

  // Create application menu
  const menu = createApplicationMenu()
  Menu.setApplicationMenu(menu)

  // Register IPC handlers
  registerIpcHandlers()

  // 收敛上次退出时遗留的运行中委派子会话（内存态丢失，无法续跑）
  safeRun('markRunningDelegationsAsInterrupted', markRunningDelegationsAsInterrupted)

  // Set dock icon on macOS
  // 确保 Dock 图标可见（dev 模式下通过 spawn 启动时可能不会自动显示）
  // 如果用户有保存的图标偏好则使用，否则用默认图标
  if (process.platform === 'darwin' && app.dock) {
    const dock = app.dock
    await dock.show()
    restoreAppIconVariant({
      platform: process.platform,
      resourcesDir: app.isPackaged ? process.resourcesPath : join(__dirname, 'resources'),
      fileExists: existsSync,
      setDockIcon: (iconPath) => dock.setIcon(iconPath),
      readVariant: () => getSettings().appIconVariant,
      saveVariant: (id) => { updateSettings({ appIconVariant: id }) },
    })
  }

  // Create main window (will be shown when ready)
  createWindow()

  // Create system tray icon
  const hoverWin = process.platform === 'win32' ? getAgentStatusHoverWindow() : null
  if (hoverWin) safeRun('ensureHoverWindow', () => hoverWin.ensureCreated())

  createTray({
    showMainWindow: showAndFocusMainWindow,
    openAgentSession: (sessionId, title) => {
      sendToMainWindow(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, { sessionId, title })
    },
    createAgentSession: () => {
      sendToMainWindow(TRAY_IPC_CHANNELS.CREATE_SESSION)
    },
    onTrayMouseEnter: hoverWin ? (bounds) => hoverWin.onTrayMouseEnter(bounds) : undefined,
    onTrayMouseMove: hoverWin ? (bounds) => hoverWin.onTrayMouseMove(bounds) : undefined,
    onTrayMouseLeave: hoverWin ? () => hoverWin.onTrayMouseLeave() : undefined,
  })

  // Windows: 将 Agent Island surface 的 pill 状态接入托盘图标 + tooltip + 通知
  if (process.platform === 'win32') {
    const surface = getWindowsAgentIslandSurface()
    surface.onTrayFlash = (flashing) => setTrayFlash(flashing)

    const notificationDeps: SurfaceDeps = {
      sendPlaySound: (type) => {
        const win = getMainWindow()
        if (win) win.webContents.send(WINDOWS_AGENT_ISLAND_IPC_CHANNELS.PLAY_SOUND, { type })
      },
      soundEnabled: () => getSettings().notificationSoundEnabled ?? true,
    }
    surface.onNotification = (transition) => processNotification(transition, notificationDeps)

    if (hoverWin) {
      surface.onHoverWindowUpdate = (snapshot) => hoverWin.updateSnapshot(snapshot)
    }
  }

  // 启动工作区文件监听（Agent MCP/Skills + 文件浏览器自动刷新）
  if (mainWindow) {
    safeRun('startWorkspaceWatcher', () => startWorkspaceWatcher(mainWindow!))
  }

  // 自动更新仅在生产环境启用，并由主进程统一检测 Agent 是否空闲。
  if (app.isPackaged && mainWindow) {
    configureUpdater(mainWindow, { hasActiveAgents: hasActiveAgentSessions })
    safeRun('initAutoUpdater', () => initAutoUpdater(mainWindow!))
  }

  // 预创建快速任务窗口（隐藏状态，首次唤起秒开）
  safeRun('createQuickTaskWindow', createQuickTaskWindow)
  if (getSettings().voiceDictation?.enabled === true) {
    safeRun('createVoiceDictationWindow', createVoiceDictationWindow)
  }

  // Agent Island 状态机在 macOS 和 Windows 都初始化；Swift surface 仅 macOS 26+。
  if (isAgentIslandServiceSupported()) {
    safeRun('initAgentIslandService', () => {
      initAgentIslandService({
        showAndFocusMainWindow,
        openAgentSession: (sessionId, title) => {
          sendToMainWindow(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, { sessionId, title })
        },
        enabled: () => getSettings().agentIsland?.enabled !== false,
      })
    })
  }

  if (isMacAgentIslandSurfaceSupported()) {
    safeRun('startAgentIslandSurface', startAgentIslandSurface)
  }

  // 飞书实时同步开启时，默认阻止系统自动休眠，保证远程群内继续可用。
  safeRun('syncFeishuSyncSleepBlocker', () => syncFeishuSyncSleepBlocker(getSettings()))

  // 注册全局快捷键
  safeRun('registerGlobalShortcut:quick-task', () =>
    registerGlobalShortcut('quick-task', toggleQuickTaskWindow),
  )
  safeRun('registerGlobalShortcut:show-main-window', () =>
    registerGlobalShortcut('show-main-window', showAndFocusMainWindow),
  )
  safeRun('registerGlobalShortcut:voice-dictation', () =>
    registerGlobalShortcut('voice-dictation', () => {
      toggleVoiceDictationWindow({ targetIsGamma: mainWindow?.isFocused() === true })
    }),
  )

  // 启动所有已注册的 Bridge（飞书/钉钉/微信等）
  await safeAwait('startAllBridges', () => startAllBridges())
  safeRun('startBridgeSelfHealing', startBridgeSelfHealing)

  // 启动定时任务调度器（恢复持久化的 active 任务）
  safeRun('startScheduler', startScheduler)
  safeRun('startPlanningReminderScheduler', startPlanningReminderScheduler)
  safeRun('startPlanningNativeSyncCoordinator', startPlanningNativeSyncCoordinator)

  app.on('activate', () => {
    if (shouldSuppressVoiceDictationActivate()) {
      return
    }

    // 直接检查 mainWindow 引用，避免 getAllWindows() 包含 DevTools 等其他窗口导致误判
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      // 窗口已存在但可能被隐藏（macOS 关闭按钮 = hide），重新显示
      showAndFocusMainWindow()
    }
  })
}

/** 同步启动钩子隔离：单点失败仅记录日志，不阻断启动链。 */
function safeRun(name: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error(`[启动] ${name} 失败（已隔离）:`, err)
  }
}

/** 异步启动钩子隔离：同 safeRun，但适用于返回 Promise 的钩子。 */
async function safeAwait(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.error(`[启动] ${name} 失败（已隔离）:`, err)
  }
}

/**
 * whenReady 顶层兜底：理论上 bootstrap 内的 safeRun/safeAwait 已经把所有可预期
 * 异常隔离掉了，能走到这里说明出了 bootstrap 本身控制流的意外（极端情况），
 * 此时仍尝试创建一个降级窗口，让用户至少能看到界面、复制日志、提交反馈。
 */
function handleBootstrapFailure(err: unknown): void {
  console.error('[启动] bootstrap 致命错误，进入降级模式:', err)

  try {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    dialog.showErrorBox(
      'Gamma 启动遇到错误',
      `部分功能可能不可用：\n\n${message}\n\n` +
        `日志位置：${app.getPath('logs')}\n\n` +
        `常见原因与排查：\n` +
        `1. 旧版 Gamma 进程未退出（终端运行 killall Gamma 后重试）\n` +
        `2. ~/.gamma/ 配置损坏（重命名 ~/.gamma 后重启）\n` +
        `3. 系统 Keychain 无法解密保存的凭证（删除 ~/.gamma/feishu.json 等后重新登录）\n\n` +
        `如需协助请到 GitHub Issues 反馈。`,
    )
  } catch {
    /* dialog 也失败，无能为力 */
  }

  try {
    registerIpcHandlers()
    createWindow()
  } catch (fallbackErr) {
    console.error('[启动] 降级窗口创建也失败:', fallbackErr)
  }
}

app.on('window-all-closed', () => {
  // 非 macOS：关闭所有窗口时退出应用
  // macOS：保持应用运行（可通过 tray 或 Dock 重新打开）
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void computerController.stop('应用正在退出')
  // 标记正在退出，让 close 事件不再阻止关闭
  setQuitting()

  // 中止所有活跃的 Agent 和终端子进程
  stopAllAgents()
  void stopAllTerminals()
  browserController.dispose()
  // 清理更新器定时器
  cleanupUpdater()
  // 停止工作区文件监听
  stopWorkspaceWatcher()
  // 停止所有 Bridge
  stopBridgeSelfHealing()
  stopAllBridges()
  // 停止定时任务调度器
  stopScheduler()
  stopPlanningReminderScheduler()
  stopPlanningNativeSyncCoordinator()
  // 释放飞书同步防休眠
  stopFeishuSyncSleepBlocker()
  // 注销全局快捷键
  unregisterAllGlobalShortcuts()
  // 销毁辅助窗口
  destroyQuickTaskWindow()
  destroyVoiceDictationWindow()
  destroyAgentStatusHoverWindow()
  // 销毁原生 macOS 灵动岛服务（其他平台从未创建 surface）
  disposeMacAgentIslandNativeHost()
  disposeAgentIslandService()
  // 关闭 Pi MCP 桥接连接（释放 stdio 子进程）
  disposePiMcpConnections().catch(() => {})
  // Clean up system tray before quitting
  destroyTray()
})
