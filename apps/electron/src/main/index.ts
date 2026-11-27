import { app, dialog, protocol, systemPreferences } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { getConfigDir } from './lib/config-paths'
import { runComputerUseDiagnostics } from './lib/computer-use-diagnostics'

export { getMainWindow } from './lib/main-window-store'

process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') return
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') return
})

// 只读诊断不能创建配置目录或获取应用实例锁。
if (!runComputerUseDiagnostics({ app, resourcesPath: process.resourcesPath, parentAccessibility: () => systemPreferences.isTrustedAccessibilityClient(false) })) {
  bootstrapCarpus()
}

function bootstrapCarpus(): void {
  try {
    const isDevelopment = !app.isPackaged || (process.env.CARPUS_DEV ?? process.env.GAMMA_DEV) === '1'
    const instance = isDevelopment ? (process.env.CARPUS_DEV_INSTANCE ?? process.env.GAMMA_DEV_INSTANCE)?.replace(/[^a-zA-Z0-9_-]/g, '') : undefined
    const instanceSuffix = instance ? `-${instance}` : ''
    const profile = join(app.getPath('appData'), isDevelopment ? `@carpus/electron-dev${instanceSuffix}` : 'Carpus')

    // 只使用 Carpus 自己的配置和浏览器数据，不探测或迁移其他应用。
    app.setName(instance ? `Carpus-${instance}` : 'Carpus')
    mkdirSync(profile, { recursive: true })
    app.setPath('userData', profile)
    app.setPath('sessionData', profile)
    if (!app.requestSingleInstanceLock()) {
      console.warn('[启动] 已有 Carpus 进程持有单实例锁，本次启动退出。')
      app.quit()
      return
    }
    getConfigDir()
    protocol.registerSchemesAsPrivileged([
      { scheme: 'carpus-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    ])
    if (process.platform === 'win32') app.commandLine.appendSwitch('disable-lcd-text')
    void app.whenReady().then(() => import('./application')).catch(handleStartupFailure)
  } catch (error) {
    handleStartupFailure(error)
  }
}

function handleStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Carpus 初始化失败。'
  console.error('[启动]', message)
  void app.whenReady().then(() => {
    dialog.showErrorBox('Carpus 启动未完成', message)
    app.quit()
  })
}
