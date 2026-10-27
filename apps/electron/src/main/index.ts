import { app, dialog, protocol, safeStorage } from 'electron'
import * as electron from 'electron'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import {
  findLegacyProfileDirectory,
  getLegacyBrandMigrationPaths,
  isLegacyBrandMigrationComplete,
  prepareLegacyBrandMigration,
  withLegacyProfileLock,
} from './lib/legacy-brand-migration'
import type { PreparedLegacyBrandMigration } from './lib/legacy-brand-migration'
import { completeBrandMigration } from './lib/complete-brand-migration'
import { importLegacyCookieProfiles, runLegacyCredentialHelper, startLegacyCredentialHelper } from './lib/legacy-credential-helper'
import { runComputerUseDiagnostics } from './lib/computer-use-diagnostics'

export { getMainWindow } from './lib/main-window-store'

process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') return
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'EIO') return
})

// 只读诊断必须先于业务/旧profile迁移/单实例锁；普通启动仍保留legacy helper分流。
if (!runComputerUseDiagnostics({ app, resourcesPath: process.resourcesPath, parentAccessibility: () => electron.systemPreferences.isTrustedAccessibilityClient(false) })) {
  if (!runLegacyCredentialHelper()) bootstrapGamma()
}


function bootstrapGamma(): void {
  const isDevelopment = !app.isPackaged || process.env.GAMMA_DEV === '1'
  const instance = isDevelopment ? process.env.GAMMA_DEV_INSTANCE?.replace(/[^a-zA-Z0-9_-]/g, '') : undefined
  const paths = getLegacyBrandMigrationPaths({ homeDirectory: homedir(), appDataDirectory: app.getPath('appData'), isDevelopment, instance })
  // 错误弹窗也会等待 ready；失败时必须使用空的隔离 profile，不能初始化旧浏览器目录。
  const bootstrapProfile = mkdtempSync(join(app.getPath('temp'), 'gamma-bootstrap-'))
  app.setPath('userData', bootstrapProfile)
  app.setPath('sessionData', bootstrapProfile)
  app.on('will-quit', () => rmSync(bootstrapProfile, { recursive: true, force: true }))
  let prepared: PreparedLegacyBrandMigration | undefined
  try {
    // 同步持有旧锁完成快照；在首次 await 前切到 Gamma，ready 不会读到旧 profile。
    const legacyProfile = isLegacyBrandMigrationComplete(paths) ? undefined : findLegacyProfileDirectory(paths)
    prepared = withLegacyProfileLock(app, legacyProfile, () => prepareLegacyBrandMigration(paths))
    app.setName(instance ? `Gamma-${instance}` : 'Gamma')
    mkdirSync(paths.profileDirectory, { recursive: true })
    app.setPath('userData', paths.profileDirectory)
    app.setPath('sessionData', paths.profileDirectory)
    if (!app.requestSingleInstanceLock()) {
      prepared.dispose()
      console.warn('[启动] 已有 Gamma 进程持有单实例锁，本次启动退出。')
      app.quit()
      return
    }
    protocol.registerSchemesAsPrivileged([
      { scheme: 'gamma-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    ])
    if (process.platform === 'win32') app.commandLine.appendSwitch('disable-lcd-text')
    const migration = prepared
    const preferredIdentity = instance ? `Proma-${instance}` : migration.legacyProfileDirectory && basename(migration.legacyProfileDirectory) === 'Proma' ? 'Proma' : '@proma/electron'
    const identities = [...new Set([preferredIdentity, '@proma/electron', 'Proma'])]
    void app.whenReady().then(async () => {
      await completeBrandMigration(migration, {
        identities,
        startHelper: (identity, snapshot) => startLegacyCredentialHelper(identity, snapshot, false),
        encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        importCookies: importLegacyCookieProfiles,
      })
      // 动态载入阻止 settings/config 服务提前创建空 Gamma 目录。
      await import('./application')
    }).catch(handleMigrationFailure)
  } catch (error) {
    prepared?.dispose()
    handleMigrationFailure(error)
  }
}

function handleMigrationFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Gamma 数据迁移失败，旧数据已保留。'
  console.error('[启动迁移]', message)
  void app.whenReady().then(() => {
    dialog.showErrorBox('Gamma 启动未完成', message)
    app.quit()
  })
}
