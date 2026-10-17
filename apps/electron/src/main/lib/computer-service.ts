import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { isComputerPlatformSupported } from './computer-platform'
import { ComputerController } from './computer-controller'
import { ComputerNativeHost } from './computer-native-host'
import { installComputerExecutionGuard } from './computer-execution-gate'
import { getMainWindow } from './main-window-store'
import { COMPUTER_IPC_CHANNELS } from '@gamma/shared'

import { computerAuthorizationManager } from './computer-authorization-manager'
export { computerAuthorizationManager }

function helperCommand(): { executable: string } {
  const bundle = 'Gamma Computer Use Helper.app'
  const executable = app.isPackaged
    ? join(app.getAppPath(), '..', '..', 'Helpers', bundle, 'Contents', 'MacOS', 'Gamma Computer Use Helper')
    : join(app.getAppPath(), 'resources', 'computer-use', bundle, 'Contents', 'MacOS', 'Gamma Computer Use Helper')
  if (process.platform !== 'darwin' || !existsSync(executable)) throw new Error('原生桌面 helper 不可用；请先构建或安装受支持的 macOS 版本')
  return { executable }
}
const host = new ComputerNativeHost(helperCommand)
export const computerController = new ComputerController(host, { supported: isComputerPlatformSupported(process.platform, release()) })
host.onStopped(() => computerController.nativeStopped())
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
