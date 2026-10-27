import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { COMPUTER_IPC_CHANNELS } from '@gamma/shared'
import { loadIsolatedModule } from '../../test-utils/isolated-module'

function createServiceFixture(packaged: boolean, exists = true, platform = 'darwin') {
  let command!: () => { executable: string }
  let stopped!: (reason: string) => void
  let receivedReason: string | undefined
  const probes: { executable: string; args: string[]; options: { env: Record<string, string | undefined> } }[] = []
  const checked: string[] = []
  class Controller {
    nativeStopped(reason: string): void { receivedReason = reason }
    assertExternalExecutionAllowed(): void {}
    onState(): void {}
  }
  class Host {
    constructor(resolveCommand: () => { executable: string }) { command = resolveCommand }
    onStopped(listener: (reason: string) => void): void { stopped = listener }
  }
  const service = loadIsolatedModule<typeof import('./computer-service')>(`${import.meta.dir}/computer-service.ts`, {
    electron: { app: { isPackaged: packaged, getVersion: () => '1.2.3', getAppPath: () => packaged ? '/Applications/Gamma.app/Contents/Resources/app.asar' : '/repo/apps/electron' } },
    'node:child_process': { spawn: (executable: string, args: string[], options: { env: Record<string, string | undefined> }) => {
      probes.push({ executable, args, options })
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('exit', 0))
      return child
    } },
    'node:fs': { existsSync: (path: string) => { checked.push(path); return exists } },
    'node:path': { join },
    'node:os': { release: () => '24.0.0' },
    './computer-platform': { isComputerPlatformSupported: () => platform === 'darwin' },
    './computer-controller': { ComputerController: Controller },
    './computer-native-host': { ComputerNativeHost: Host },
    './computer-logger': { getComputerLogPath: () => '/tmp/computer-use.log' },
    './computer-execution-gate': { installComputerExecutionGuard: () => {} },
    './main-window-store': { getMainWindow: () => undefined },
    '@gamma/shared': { COMPUTER_IPC_CHANNELS },
    './computer-authorization-manager': { computerAuthorizationManager: { onAppAuthRequested: () => {}, onRiskConfirmRequested: () => {} } },
  }, { process: { platform, env: { HOME: '/tmp' }, resourcesPath: '/Applications/Gamma.app/Contents/Resources' } })
  return { command, checked, stopped, service, probes, lastStopReason: () => receivedReason }
}

describe('Given Computer Use主应用CLI路径', () => {
  test('When 应用启动且平台支持 Then 异步启动原生自检；不支持时不启动', async () => {
    const supported = createServiceFixture(true)
    supported.service.startNativeLoggerSelfCheck()
    expect(supported.probes).toHaveLength(0)
    await Promise.resolve()
    expect(supported.probes).toHaveLength(1)
    expect(supported.probes[0]?.args).toEqual(['--logger-probe'])
    expect(supported.probes[0]?.options.env).toMatchObject({ GAMMA_COMPUTER_LOG_PATH: '/tmp/computer-use.log', GAMMA_APP_VERSION: '1.2.3' })
    const unsupported = createServiceFixture(true, true, 'linux')
    unsupported.service.startNativeLoggerSelfCheck()
    await Promise.resolve()
    expect(unsupported.probes).toHaveLength(0)
  })
  test('When 原生自检启动 Then 在 AppKit 和权限 API 之前写日志并退出', () => {
    const source = readFileSync(join(import.meta.dir, '../../../native/computer-use/main.swift'), 'utf8')
    const probe = source.slice(source.indexOf('if CommandLine.arguments == [CommandLine.arguments[0], "--logger-probe"]'), source.indexOf('// 必须在访问NSApplication'))
    expect(probe).toContain('writeNativeLoggerReady()')
    expect(probe).toContain('exit(0)')
    expect(probe).not.toMatch(/NSApplication|Engine\(|AXIs|CGPreflight|CGRequest|prompt/i)
    expect(source.indexOf('exit(0)')).toBeLessThan(source.indexOf('NSApplication.shared'))
  })
  test('When 正式安装包解析helper Then 只从Gamma Resources查找裸CLI', () => {
    const fixture = createServiceFixture(true)
    expect(fixture.command()).toEqual({ executable: '/Applications/Gamma.app/Contents/Resources/computer-use/gamma-computer-use-helper' })
    expect(fixture.checked).toEqual(['/Applications/Gamma.app/Contents/Resources/computer-use/gamma-computer-use-helper'])
  })
  test('When 开发态解析helper Then 使用仓库resources裸CLI', () => {
    expect(createServiceFixture(false).command()).toEqual({ executable: '/repo/apps/electron/resources/computer-use/gamma-computer-use-helper' })
  })
  test('When 裸CLI缺失或平台不支持 Then 明确拒绝且不回退旧独立app', () => {
    const missing = createServiceFixture(true, false)
    expect(() => missing.command()).toThrow('原生桌面 helper 不可用')
    expect(missing.checked.some(path => path.includes('Gamma Computer Use Helper.app'))).toBe(false)
    expect(() => createServiceFixture(true, true, 'linux').command()).toThrow('原生桌面 helper 不可用')
  })
  test('When 原生helper通知停止 Then 精确保留原因供用户诊断', () => {
    const fixture = createServiceFixture(true)
    fixture.stopped('辅助功能权限已撤销')
    expect(fixture.lastStopReason()).toBe('辅助功能权限已撤销')
  })
})
