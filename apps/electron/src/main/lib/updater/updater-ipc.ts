/**
 * 自动更新 IPC 处理器
 *
 * 注册更新相关的 IPC 通道，供渲染进程调用。
 */

import { BrowserWindow, ipcMain } from 'electron'
import { UPDATER_IPC_CHANNELS } from './updater-types'
import type { UpdateStatus } from './updater-types'
import {
  cancelIdleInstall,
  checkForUpdates,
  getUpdateStatus,
  installWhenIdle,
  revealDownloadedUpdate,
} from './auto-updater'

/** 注册更新 IPC 处理器 */
export function registerUpdaterIpc(): void {
  console.log('[更新 IPC] 正在注册更新 IPC 处理器...')

  ipcMain.handle(
    UPDATER_IPC_CHANNELS.CHECK_FOR_UPDATES,
    async (): Promise<void> => {
      await checkForUpdates()
    }
  )

  ipcMain.handle(
    UPDATER_IPC_CHANNELS.GET_STATUS,
    async (): Promise<UpdateStatus> => {
      return getUpdateStatus()
    }
  )

  ipcMain.handle(
    UPDATER_IPC_CHANNELS.INSTALL_WHEN_IDLE,
    (): boolean => {
      return installWhenIdle()
    }
  )

  ipcMain.handle(
    UPDATER_IPC_CHANNELS.CANCEL_IDLE_INSTALL,
    (): void => {
      cancelIdleInstall()
    }
  )

  ipcMain.handle(UPDATER_IPC_CHANNELS.REVEAL_DOWNLOADED_UPDATE, (event): boolean => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('仅应用主页面可以显示更新包')
    return revealDownloadedUpdate()
  })

  console.log('[更新 IPC] 更新 IPC 处理器注册完成')
}
