import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { isComputerPlatformSupported } from './computer-platform'
import { ComputerController } from './computer-controller'
import { ComputerNativeHost } from './computer-native-host'
import { getComputerLogPath } from './computer-logger'
import { installComputerExecutionGuard } from './computer-execution-gate'
import { getMainWindow } from './main-window-store'
import { COMPUTER_IPC_CHANNELS } from '@gamma/shared'

import { computerAuthorizationManager } from './computer-authorization-manager'
export { computerAuthorizationManager }

function helperCommand(): { executable: string } {
  const filename = 'gamma-computer-use-helper'
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'computer-use', filename)
    : join(app.getAppPath(), 'resources', 'computer-use', filename)
  if (process.platform !== 'darwin' || !existsSync(executable)) throw new Error('原生桌面 helper 不可用；请先构建或安装受支持的 macOS 版本')
  return { executable }
}
const supported = isComputerPlatformSupported(process.platform, release())
const loggerEnvironment = (): { logPath: string; version: string } => ({ logPath: getComputerLogPath(), version: app.getVersion() })
const host = new ComputerNativeHost(helperCommand, { loggerEnvironment })
export const computerController = new ComputerController(host, { supported })
/** 应用启动时异步唤起 helper，让其写入原生日志自检；失败不阻塞启动。 */
export function startNativeLoggerSelfCheck(): void {
  if (!supported) return
  // 专用入口只写日志并退出，不启动 AppKit、桌面引擎或权限检查。
  void Promise.resolve().then(() => {
    const command = helperCommand()
    let environment: { logPath: string; version: string } | undefined
    try { environment = loggerEnvironment() } catch { /* 日志配置失败不阻塞启动 */ }
    const child = spawn(command.executable, ['--logger-probe'], {
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, LANG: 'en_US.UTF-8', GAMMA_COMPUTER_LOG_PATH: environment?.logPath, GAMMA_APP_VERSION: environment?.version },
    })
    const timeout = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 探针回收失败不影响应用 */ } }, 5000)
    const finish = (): void => clearTimeout(timeout)
    child.once('error', finish)
    child.once('exit', finish)
  }).catch(() => {})
}
host.onStopped(reason => computerController.nativeStopped(reason))
installComputerExecutionGuard(() => computerController.assertExternalExecutionAllowed())
computerController.onState(state => {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(COMPUTER_IPC_CHANNELS.STATE_CHANGED, state)
})
computerAuthorizationManager.onAppAuthRequested(req => {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show(); window.focus()
  window.webContents.send(COMPUTER_IPC_CHANNELS.APP_AUTH_REQUESTED, req)
})
computerAuthorizationManager.onRiskConfirmRequested(req => {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show(); window.focus()
  window.webContents.send(COMPUTER_IPC_CHANNELS.RISK_CONFIRM_REQUESTED, req)
})
