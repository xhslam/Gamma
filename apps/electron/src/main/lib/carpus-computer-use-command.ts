import { execFile, execFileSync } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentDesktopCommand, AgentDesktopRunIdentity } from './agent-desktop-host'

const exec = promisify(execFile)
export const CARPUS_COMPUTER_USE_APP = '/Applications/carpusComputerUse.app'
export const CARPUS_COMPUTER_USE_EXECUTABLE = join(CARPUS_COMPUTER_USE_APP, 'Contents/MacOS/carpusComputerUse')

interface ComponentDependencies {
  validate(): void
  invoke(args: string[], identity?: AgentDesktopRunIdentity): Promise<string>
  launch(): Promise<void>
  now(): number
  wait(): Promise<void>
}

function identityEnvironment(identity: AgentDesktopRunIdentity): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin', HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8',
    AGENT_DESKTOP_HOME: join(identity.root, 'state'),
    AGENT_DESKTOP_SESSION: identity.sessionId,
    AGENT_DESKTOP_NO_UPDATE_NOTIFIER: '1',
  }
}

/** 固定安装位置，不接受环境变量替换权限持有者，也不静默回退到 Carpus 内置引擎。 */
export function validateCarpusComputerUseInstallation(): void {
  if (!existsSync(CARPUS_COMPUTER_USE_EXECUTABLE)) {
    throw new Error('尚未安装 carpusComputerUse；请先独立安装桌面操作组件。Carpus 更新不会自动替换该组件。')
  }
  for (const path of [CARPUS_COMPUTER_USE_APP, join(CARPUS_COMPUTER_USE_APP, 'Contents'), join(CARPUS_COMPUTER_USE_APP, 'Contents/MacOS'), CARPUS_COMPUTER_USE_EXECUTABLE]) {
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink() || (metadata.mode & 0o022) !== 0 || (metadata.uid !== 0 && metadata.uid !== process.getuid?.())) {
      throw new Error('carpusComputerUse 安装路径不可信；请检查组件安装。')
    }
    if (realpathSync(path) !== path) throw new Error('carpusComputerUse 安装路径不能包含符号链接。')
  }
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', CARPUS_COMPUTER_USE_APP], { timeout: 5000, stdio: 'pipe' })
    execFileSync('/usr/bin/codesign', ['--verify', '-R', '=identifier "com.carpus.computeruse"', CARPUS_COMPUTER_USE_APP], { timeout: 5000, stdio: 'pipe' })
  } catch {
    throw new Error('carpusComputerUse 签名或应用身份校验失败；未启动桌面引擎。')
  }
}

const defaults: ComponentDependencies = {
  validate: validateCarpusComputerUseInstallation,
  async invoke(args, identity) {
    const { stdout } = await exec(CARPUS_COMPUTER_USE_EXECUTABLE, args, {
      timeout: 8000, maxBuffer: 64 * 1024,
      ...(identity && { cwd: identity.root, env: identityEnvironment(identity) }),
    })
    return stdout
  },
  async launch() {
    // LaunchServices 创建独立应用责任链；不能 spawn 服务端，否则可能仍把 TCC 归给 Carpus。
    await exec('/usr/bin/open', ['-g', CARPUS_COMPUTER_USE_APP], { timeout: 5000, maxBuffer: 64 * 1024 })
  },
  now: Date.now,
  wait: () => new Promise(resolve => setTimeout(resolve, 100)),
}

function assertHandshake(stdout: string): void {
  const response: unknown = JSON.parse(stdout)
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || (response as Record<string, unknown>).kind !== 'hello'
    || (response as Record<string, unknown>).version !== 1
    || (response as Record<string, unknown>).engine !== '1.0.2') {
    throw new Error('carpusComputerUse 通信协议不兼容；请手动检查独立组件版本。')
  }
}

/** 每次操作前只对无副作用的握手重试；桌面命令投递后绝不自动重放。 */
export function createCarpusComputerUseCommand(overrides: Partial<ComponentDependencies> = {}): AgentDesktopCommand {
  const dependencies = { ...defaults, ...overrides }
  dependencies.validate()
  let preparing: Promise<void> | undefined
  const connect = async (): Promise<void> => {
    let stdout: string
    try {
      stdout = await dependencies.invoke(['--ping'])
    } catch {
      await dependencies.launch()
      const deadline = dependencies.now() + 5000
      while (true) {
        try { stdout = await dependencies.invoke(['--ping']); break }
        catch {
          if (dependencies.now() >= deadline) throw new Error('无法连接独立 carpusComputerUse；未投递桌面操作。')
          await dependencies.wait()
        }
      }
    }
    // 已连接但协议不兼容时不重新启动或替换组件。
    assertHandshake(stdout)
  }
  return {
    executable: CARPUS_COMPUTER_USE_EXECUTABLE,
    argsPrefix: ['--client'],
    requireSuccessfulExit: true,
    async prepare() {
      if (!preparing) preparing = connect().finally(() => { preparing = undefined })
      await preparing
    },
    async stop(identity) {
      // 必须由服务端确认真实执行进程已经停止；仅杀死本地代理不算完成。
      const stdout = await dependencies.invoke(['--stop-session', identity.sessionId], identity)
      const response: unknown = JSON.parse(stdout)
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || (response as Record<string, unknown>).kind !== 'stopped'
        || (response as Record<string, unknown>).exitCode !== 0) {
        throw new Error('carpusComputerUse 未确认执行者停止。')
      }
    },
  }
}
