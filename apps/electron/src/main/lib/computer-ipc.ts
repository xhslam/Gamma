import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  COMPUTER_IPC_CHANNELS,
  type ComputerAppAuthDecision,
  type ComputerArmInput,
  type ComputerPermission,
  type ComputerUsePreferences,
} from '@gamma/shared'
import { getMainWindow } from './main-window-store'
import { armComputer, computerAuthorizationManager, computerController } from './computer-service'
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
    return armComputer(input)
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.STOP, event => { verify(event); return computerController.stop() })
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
    return computerAuthorizationManager.resolveAppAuth(requestId, decision)
  })
  ipcMain.handle(COMPUTER_IPC_CHANNELS.DECIDE_RISK_CONFIRM, (event, requestId: string, confirmed: boolean) => {
    verify(event, true)
    return computerAuthorizationManager.resolveRiskConfirm(requestId, confirmed)
  })
}

