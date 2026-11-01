import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { COMPUTER_IPC_CHANNELS } from '@gamma/shared'
import { loadIsolatedModule } from '../../test-utils/isolated-module'

function createServiceFixture(packaged: boolean, exists = true, platform = 'darwin') {
  let commandResolver!: () => { executable: string }
  const checked: string[] = []

  class MockController {
    assertExternalExecutionAllowed(): void {}
    onState(): void {}
  }

  class MockHost {
    constructor(resolveCommand: () => { executable: string }) {
      commandResolver = resolveCommand
    }
  }

  const service = loadIsolatedModule<typeof import('./computer-service')>(
    `${import.meta.dir}/computer-service.ts`,
    {
      electron: {
        app: {
          isPackaged: packaged,
          getVersion: () => '1.2.3',
          getAppPath: () =>
            packaged
              ? '/Applications/Gamma.app/Contents/Resources/app.asar'
              : '/repo/apps/electron',
        },
      },
      'node:fs': {
        existsSync: (path: string) => {
          checked.push(path)
          return exists
        },
      },
      'node:path': { join },
      'node:os': { release: () => '24.0.0' },
      './computer-platform': { isComputerPlatformSupported: () => true },
      './computer-controller': { ComputerController: MockController },
      './agent-desktop-host': { AgentDesktopHost: MockHost },
      './computer-execution-gate': { installComputerExecutionGuard: () => {} },
      './main-window-store': { getMainWindow: () => undefined },
      '@gamma/shared': { COMPUTER_IPC_CHANNELS },
      './computer-authorization-manager': {
        computerAuthorizationManager: {
          onAppAuthRequested: () => {},
          onRiskConfirmRequested: () => {},
        },
      },
    },
    {
      process: {
        platform,
        env: { HOME: '/tmp' },
        resourcesPath: '/Applications/Gamma.app/Contents/Resources',
      },
    },
  )

  return {
    commandResolver: () => service.agentDesktopCommand(),
    checked,
    service,
  }
}

describe('Given agent-desktop 路径解析与服务初始化', () => {
  test('When 正式安装包解析 CLI Then 从 Gamma Resources/agent-desktop 目录查找', () => {
    const fixture = createServiceFixture(true)
    expect(fixture.commandResolver()).toEqual({
      executable:
        '/Applications/Gamma.app/Contents/Resources/agent-desktop/agent-desktop',
    })
    expect(fixture.checked).toContain(
      '/Applications/Gamma.app/Contents/Resources/agent-desktop/agent-desktop',
    )
  })

  test('When 开发态解析 CLI Then 使用仓库 resources/agent-desktop 路径', () => {
    const fixture = createServiceFixture(false)
    expect(fixture.commandResolver()).toEqual({
      executable: '/repo/apps/electron/resources/agent-desktop/agent-desktop',
    })
  })

  test('When Windows 平台 Then 自动附加 .exe 后缀', () => {
    const fixture = createServiceFixture(true, true, 'win32')
    expect(fixture.commandResolver()).toEqual({
      executable:
        '/Applications/Gamma.app/Contents/Resources/agent-desktop/agent-desktop.exe',
    })
  })

  test('When 可执行文件缺失 Then 明确报错引导用户准备资源', () => {
    const missing = createServiceFixture(true, false)
    expect(() => missing.commandResolver()).toThrow('agent-desktop 可执行文件不存在')
  })

  test('When 启动自检存根调用 Then 保持安全空操作并不抛错', () => {
    const fixture = createServiceFixture(true)
    expect(() => fixture.service.startNativeLoggerSelfCheck()).not.toThrow()
  })
})
