import { describe, expect, test } from 'bun:test'
import type { IpcMainInvokeEvent } from 'electron'
import { COMPUTER_IPC_CHANNELS } from '@gamma/shared'
import { createComputerFixture } from '../../test-utils/computer-fixture'
import { loadIsolatedModule } from '../../test-utils/isolated-module'
import { assertComputerSender } from './computer-ipc-policy'

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type IpcModule = typeof import('./computer-ipc')
function createIpcFixture(options: { failStatus?: boolean } = {}) {
  let accessibility = true
  const fixture = createComputerFixture({ call: async method => {
    if (method !== 'status') return undefined
    if (options.failStatus) throw new Error('无法读取原生权限状态')
    return { supported: true, permissions: { accessibility, screen: false, listen: false, post: false } }
  } })
  const handlers = new Map<string, IpcHandler>()
  const frame = {}
  const event = { sender: { id: 7, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const window = { isDestroyed: () => false, isVisible: () => false, isFocused: () => false, webContents: { id: 7 } }
  const { registerComputerIpc } = loadIsolatedModule<IpcModule>(`${import.meta.dir}/computer-ipc.ts`, {
    electron: { ipcMain: { handle: (channel: string, handler: IpcHandler) => { handlers.set(channel, handler) } } },
    '@gamma/shared': { COMPUTER_IPC_CHANNELS },
    './main-window-store': { getMainWindow: () => window },
    './computer-service': { computerController: fixture.controller, computerAuthorizationManager: fixture.auth },
    './computer-ipc-policy': { assertComputerSender },
  })
  registerComputerIpc()
  const readState = (sessionId: unknown = fixture.binding.sessionId, sender = event): unknown => handlers.get(COMPUTER_IPC_CHANNELS.GET_STATE)!(sender, sessionId)
  return { ...fixture, event, readState, revokeAccessibility: () => { accessibility = false } }
}

describe('Given renderer 通过 IPC 查询当前电脑权限', () => {
  test('When 首次读取与系统撤权后再次读取 Then 每次只查询真实状态，不开始观察或请求授权', async () => {
    const f = createIpcFixture()
    try {
      expect(f.controller.getState().permissions).toBeUndefined()
      await expect(Promise.resolve(f.readState())).resolves.toMatchObject({ permissions: { accessibility: true, screen: false, listen: false, post: false } })
      f.revokeAccessibility()
      await expect(Promise.resolve(f.readState())).resolves.toMatchObject({ permissions: { accessibility: false, screen: false, listen: false, post: false } })
      expect(f.calls.map(call => call.method)).toEqual(['status', 'status'])
      expect(f.actions).toHaveLength(0)
      expect(f.controller.isDesktopRun(f.binding)).toBe(false)
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 原生状态读取失败 Then 明确拒绝，让 renderer 显示重试而非返回旧授权', async () => {
    const f = createIpcFixture({ failStatus: true })
    try {
      await expect(Promise.resolve(f.readState())).rejects.toThrow('无法读取原生权限状态')
      expect(f.calls.map(call => call.method)).toEqual(['status'])
      expect(f.controller.getState().permissions).toBeUndefined()
      expect(f.controller.isRunStopped(f.binding.runId)).toBe(false)
    } finally { await f.controller.finishRun(f.binding) }
  })
  test('When 非主窗口、子 frame 或无效会话查询 Then 在访问原生状态前拒绝', async () => {
    const f = createIpcFixture()
    try {
      for (const sessionId of [123, null, 'x'.repeat(129)]) expect(() => f.readState(sessionId)).toThrow('无效会话')
      const otherWindow = { ...f.event, sender: { ...f.event.sender, id: 8 } } as IpcMainInvokeEvent
      const childFrame = { ...f.event, senderFrame: {} } as IpcMainInvokeEvent
      expect(() => f.readState(f.binding.sessionId, otherWindow)).toThrow('主窗口顶层')
      expect(() => f.readState(f.binding.sessionId, childFrame)).toThrow('主窗口顶层')
      expect(f.calls).toHaveLength(0)
    } finally { await f.controller.finishRun(f.binding) }
  })
})
