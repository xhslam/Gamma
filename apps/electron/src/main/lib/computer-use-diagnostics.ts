import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ComputerNativeHost } from './computer-native-host'
import { writeTextFileAtomic } from './safe-file'

interface DiagnosticsApp {
  readonly isPackaged: boolean
  setName(name: string): void
  setPath(name: 'userData' | 'sessionData', path: string): void
  getPath(name: 'exe'): string
  getAppPath(): string
  getVersion(): string
  whenReady(): Promise<void>
  on(event: 'will-quit', callback: () => void): unknown
  quit(): void
}
interface DiagnosticsHost {
  call(method: 'status', params: Record<string, unknown>, timeoutMs: number): Promise<unknown>
  terminate(): Promise<void>
}
interface DiagnosticPermissions {
  accessibility: boolean
  screen: boolean
  listen: boolean
  post: boolean
}
export interface ComputerUseDiagnosticsOptions {
  app: DiagnosticsApp
  parentAccessibility(): boolean
  resourcesPath: string
  argv?: readonly string[]
  /** 仅用于离线测试替换进程通道；命令行不接受可执行文件或输出路径。 */
  createHost?(executable: string): DiagnosticsHost
}
export interface ComputerUseDiagnosticsReport {
  kind: 'gamma-computer-use-diagnostics'
  pid: number
  createdAt: string
  packaged: boolean
  version: string
  parentExecutable: string
  helperExecutable: string
  parentAX: boolean | null
  helperPermissions: DiagnosticPermissions | null
  /** 只比较实际AX状态；false/false不能证明已授权时的责任继承。 */
  identitiesMatch: boolean | null
  inheritanceVerified: boolean
  readOnly: true
  errors: string[]
}

function permissionsFromStatus(status: unknown): DiagnosticPermissions {
  if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('invalid-status')
  const permissions = (status as Record<string, unknown>).permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) throw new Error('invalid-status')
  const value = permissions as Record<string, unknown>
  if (['accessibility', 'screen', 'listen', 'post'].some(key => typeof value[key] !== 'boolean')) throw new Error('invalid-status')
  // 白名单复制，绝不保存helper的message、AX文字、图像或其他未知字段。
  return { accessibility: value.accessibility as boolean, screen: value.screen as boolean, listen: value.listen as boolean, post: value.post as boolean }
}

/** 同步设置隔离profile后才首次await；返回undefined时由原有启动流程继续。 */
export function runComputerUseDiagnostics(options: ComputerUseDiagnosticsOptions): Promise<void> | undefined {
  if (!(options.argv ?? process.argv).includes('--computer-use-diagnostics')) return undefined
  return collectComputerUseDiagnostics(options)
}

async function collectComputerUseDiagnostics(options: ComputerUseDiagnosticsOptions): Promise<void> {
  const { app } = options
  const reportPath = `/tmp/gamma-computer-use-diagnostics-${process.pid}.json`
  const report: ComputerUseDiagnosticsReport = {
    kind: 'gamma-computer-use-diagnostics', pid: process.pid, createdAt: new Date().toISOString(),
    packaged: app.isPackaged, version: '', parentExecutable: '', helperExecutable: '',
    parentAX: null, helperPermissions: null, identitiesMatch: null, inheritanceVerified: false,
    readOnly: true, errors: [],
  }
  let profile: string | undefined
  let host: DiagnosticsHost | undefined
  const cleanup = (): void => {
    if (!profile) return
    try { rmSync(profile, { recursive: true, force: true }); profile = undefined } catch { /* 退出时再次尝试，不输出系统错误。 */ }
  }
  try {
    app.setName('Gamma')
    profile = mkdtempSync('/tmp/gamma-computer-use-diagnostics-profile-')
    app.setPath('userData', profile)
    app.setPath('sessionData', profile)
    app.on('will-quit', cleanup)
    await app.whenReady()
    report.version = String(app.getVersion()).slice(0, 64)
    report.parentExecutable = app.getPath('exe')
    report.helperExecutable = app.isPackaged
      ? join(options.resourcesPath, 'computer-use', 'gamma-computer-use-helper')
      : join(app.getAppPath(), 'resources', 'computer-use', 'gamma-computer-use-helper')
    try { report.parentAX = options.parentAccessibility() }
    catch { report.errors.push('parent-accessibility-check-failed') }
    if (!existsSync(report.helperExecutable) && !options.createHost) {
      report.errors.push('native-helper-unavailable')
    } else {
      host = options.createHost?.(report.helperExecutable) ?? new ComputerNativeHost(() => ({ executable: report.helperExecutable }))
      try { report.helperPermissions = permissionsFromStatus(await host.call('status', {}, 5000)) }
      catch { report.errors.push('native-status-failed') }
    }
    if (report.parentAX !== null && report.helperPermissions !== null) {
      report.identitiesMatch = report.parentAX === report.helperPermissions.accessibility
      report.inheritanceVerified = report.parentAX && report.helperPermissions.accessibility
    }
  } catch {
    report.errors.push('diagnostics-initialization-failed')
  } finally {
    if (host) {
      try { await host.terminate() } catch { report.errors.push('native-termination-unconfirmed') }
    }
    let reportWritten = false
    try {
      // 使用随机私有临时兄弟文件+rename，避免可预测/tmp目标的符号链接写入。
      writeTextFileAtomic(reportPath, JSON.stringify(report, null, 2), 0o600)
      reportWritten = true
    } catch { /* stdout仅报告是否保存，不泄露任意异常文本。 */ }
    console.log(JSON.stringify({ diagnosticsReportPath: reportPath, reportWritten }))
    app.quit()
    cleanup()
  }
}
