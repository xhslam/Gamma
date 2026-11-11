import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { isComputerPlatformSupported } from './computer-platform'
import { ComputerController } from './computer-controller'
import { AgentDesktopHost, type AgentDesktopCommand } from './agent-desktop-host'
import { createGammaComputerUseCommand } from './gamma-computer-use-command'
import { installComputerExecutionGuard } from './computer-execution-gate'
import { getMainWindow } from './main-window-store'
import { COMPUTER_IPC_CHANNELS } from '@gamma/shared'
import { computerAuthorizationManager } from './computer-authorization-manager'

export { computerAuthorizationManager }

export function agentDesktopCommand(): AgentDesktopCommand {
  if (process.platform === 'darwin') return createGammaComputerUseCommand()
  const filename = process.platform === 'win32' ? 'agent-desktop.exe' : 'agent-desktop'
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'agent-desktop', filename)
    : join(app.getAppPath(), 'resources', 'agent-desktop', filename)
  if (!existsSync(executable)) {
    throw new Error('agent-desktop 可执行文件不存在；请先运行 bun run prepare:agent-desktop')
  }
  return { executable }
}

const supported = isComputerPlatformSupported(process.platform, release())
const host = new AgentDesktopHost(agentDesktopCommand)
export const computerController = new ComputerController(host, { supported })

/** 启动自检存根（旧 Swift logger-probe 已移除） */
export function startNativeLoggerSelfCheck(): void {
  // agent-desktop 无需向后启动 Swift 探针
}

installComputerExecutionGuard(() => computerController.assertExternalExecutionAllowed())

computerController.onState((state) => {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(COMPUTER_IPC_CHANNELS.STATE_CHANGED, state)
})

computerAuthorizationManager.onAppAuthRequested((req) => {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send(COMPUTER_IPC_CHANNELS.APP_AUTH_REQUESTED, req)
})

computerAuthorizationManager.onRiskConfirmRequested((req) => {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send(COMPUTER_IPC_CHANNELS.RISK_CONFIRM_REQUESTED, req)
})
