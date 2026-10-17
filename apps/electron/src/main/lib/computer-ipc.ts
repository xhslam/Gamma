import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  COMPUTER_IPC_CHANNELS,
  type ComputerAppAuthDecision,
  type ComputerArmInput,
  type ComputerPermission,
  type ComputerUsePreferences,
} from '@gamma/shared'
import { getMainWindow } from './main-window-store'
import { computerAuthorizationManager, computerController } from './computer-service'
import { assertComputerSender } from './computer-ipc-policy'

export function registerComputerIpc(): void {
  const verify = (event: IpcMainInvokeEvent, focused = false): void => {
    const window = getMainWindow()
    assertComputerSender({
      matchesMainWindow: !!window && !window.isDestroyed() && event.sender.id === window.webContents.id,
      matchesTopFrame: !!event.senderFrame && event.senderFrame === event.sender.mainFrame,
      visible: !!window?.isVisible(), focused: !!window?.isFocused(), requiresFocus: focused,
    })
  }
  ipcMain.handle(COMPUTER_IPC_CHANNELS.GET_STATE, (event, sessionId?: string) => {
    verify(event)
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 128)) throw new Error('无效会话')
    return computerController.getState(sessionId)
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.ARM, (event, input: ComputerArmInput) => {
    verify(event, true)
    if (!input || Object.keys(input).some(key => !['sessionId', 'consentId', 'shareObservations'].includes(key)) || typeof input.sessionId !== 'string' || typeof input.consentId !== 'string' || input.shareObservations !== true) throw new Error('缺少当前本地授权上下文')
    throw new Error('手动桌面模式已停用；直接在会话中描述任务即可')
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.STOP, event => { verify(event); return computerController.stop() })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.RESUME, event => { verify(event, true); return computerController.resume() })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.PERMISSION, (event, permission: ComputerPermission) => {
    verify(event, true)
    return computerController.requestPermission(permission)
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.GET_PREFERENCES, (event) => {
    verify(event)
    return computerAuthorizationManager.getPreferences()
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.UPDATE_PREFERENCES, (event, partial: Partial<ComputerUsePreferences>) => {
    verify(event, true)
    return computerAuthorizationManager.updatePreferences(partial)
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.DECIDE_APP_AUTH, (event, requestId: string, decision: ComputerAppAuthDecision) => {
    verify(event, true)
    if (typeof requestId !== 'string' || requestId.length > 128 || !['once', 'always', 'denied'].includes(decision)) throw new Error('无效授权决定')
    return computerAuthorizationManager.resolveAppAuth(requestId, decision)
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.DECIDE_RISK_CONFIRM, (event, requestId: string, confirmed: boolean) => {
    verify(event, true)
    if (typeof requestId !== 'string' || requestId.length > 128 || typeof confirmed !== 'boolean') throw new Error('无效确认决定')
    return computerAuthorizationManager.resolveRiskConfirm(requestId, confirmed)
  })
}

