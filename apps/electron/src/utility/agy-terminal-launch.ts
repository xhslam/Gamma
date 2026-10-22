import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { createAgyEnvironment, createAgyInvocation, resolveAgyExecutable } from '../main/lib/agy-process-launch'

interface AgyTerminalLaunchOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  /** 仅供内部配置及测试，不接收 renderer 路径或任意参数。 */
  executable?: string
  canExecute?: (path: string) => boolean
}

export interface AgyTerminalLaunch {
  file: string
  /** node-pty 在 Windows batch 分支使用已转义的完整命令行，其他平台使用 argv。 */
  args: string[] | string
  env: NodeJS.ProcessEnv
}

/** AGY 为 PTY 的前台程序，不打开外部 shell，也不执行用户的 PowerShell/zsh profile。 */
export function resolveAgyTerminalLaunch(options: AgyTerminalLaunchOptions = {}): AgyTerminalLaunch {
  const platform = options.platform ?? process.platform
  const source = options.env ?? process.env
  const home = options.home ?? homedir()
  const path = platform === 'win32' ? win32 : posix
  const executable = resolveAgyExecutable({ ...options, platform, env: source, home })
  const env = createAgyEnvironment(source, platform)
  const delimiter = platform === 'win32' ? ';' : ':'
  const candidates = [
    ...(env.PATH ?? '').split(delimiter).map(value => value.trim().replace(/^"(.*)"$/, '$1')),
    path.dirname(executable),
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    ...(platform === 'win32'
      ? [win32.join(env.SYSTEMROOT || 'C:\\Windows', 'System32')]
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']),
  ]
  const seen = new Set<string>()
  env.PATH = candidates.filter(directory => {
    // GUI 的精简 PATH 也应可使用 Homebrew/官方 CLI；不从项目相对路径加载同名工具。
    if (!path.isAbsolute(directory)) return false
    const key = platform === 'win32' ? path.normalize(directory).toLowerCase() : path.normalize(directory)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join(delimiter)
  if (platform === 'darwin' && !env.LANG) env.LANG = 'en_US.UTF-8'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Gamma'
  const invocation = createAgyInvocation(executable, ['--dangerously-skip-permissions'], env, platform)
  return {
    file: invocation.command,
    args: invocation.windowsVerbatimArguments ? invocation.args.join(' ') : [...invocation.args],
    env,
  }
}
