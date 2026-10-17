import { mock } from 'bun:test'

/**
 * 全局测试预加载脚本：为 Bun 单进程测试环境提供基础的 Electron ESM 导出替身，
 * 避免未运行在 Electron 运行时的单进程测试因缺少 ESM 命名导出而抛出 SyntaxError。
 */
mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => `/tmp/gamma-test/${name}`,
    getAppPath: () => process.cwd(),
    getName: () => 'Gamma',
    getVersion: () => '0.19.97',
    on: () => {},
    once: () => {},
    quit: () => {},
    focus: () => {},
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (val: string) => Buffer.from(val),
    decryptString: (buf: Buffer) => buf.toString('utf8'),
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
  },
  clipboard: {
    readText: () => '',
    writeText: () => {},
    readImage: () => ({ isEmpty: () => true, toPNG: () => Buffer.from('') }),
    read: () => '',
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {
    static getAllWindows = () => []
    static getFocusedWindow = () => null
    webContents = { id: 1, send: () => {}, on: () => {} }
    isVisible = () => true
    isFocused = () => true
    isDestroyed = () => false
  },
  screen: {
    getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }),
  },
  nativeImage: {
    createFromPath: () => ({}),
  },
  systemPreferences: {
    // 基础替身不声明任何系统授权；成功路径应由具体测试显式提供。
    getMediaAccessStatus: () => 'not-determined',
  },
  powerMonitor: { on: () => {} },
  powerSaveBlocker: { start: () => 1, stop: () => {} },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
  },
  session: {
    defaultSession: {
      cookies: {
        get: async () => [],
        set: async () => {},
        flushStore: async () => {},
      },
      enableNetworkEmulation: () => {},
      webRequest: { onBeforeRequest: () => {} },
    },
    fromPartition: () => ({
      cookies: {
        get: async () => [],
        set: async () => {},
        flushStore: async () => {},
      },
      enableNetworkEmulation: () => {},
      webRequest: { onBeforeRequest: () => {} },
    }),
  },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  protocol: { registerSchemesAsPrivileged: () => {} },
  net: { isOnline: () => true },
  utilityProcess: { fork: () => ({ on: () => {}, postMessage: () => {} }) },
  MessageChannelMain: class {
    port1 = { on: () => {}, start: () => {}, close: () => {}, postMessage: () => {} }
    port2 = { on: () => {}, start: () => {}, close: () => {}, postMessage: () => {} }
  },
}))
