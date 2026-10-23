import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

interface AgyExecutableOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  /** 仅由主进程/测试设置；工具和 renderer 不接受程序路径。 */
  executable?: string
  canExecute?: (path: string) => boolean
}
export interface AgyInvocation {
  command: string
  args: readonly string[]
  windowsVerbatimArguments?: boolean
}

function environmentValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find(key => key.toUpperCase() === name.toUpperCase())
  return key ? env[key] : undefined
}
function unquote(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed
}
function executableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch { return false }
}

/** 每次启动重新发现；不调用登录 shell，也不搜索 cwd/相对 PATH 项，避免项目同名文件劫持。 */
export function resolveAgyExecutable(options: AgyExecutableOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const path = platform === 'win32' ? win32 : posix
  const get = (name: string) => environmentValue(env, name, platform)
  const expand = (value: string) => platform === 'win32' ? value.replace(/%([^%]+)%/g, (match, name: string) => get(name) ?? match) : value
  const canExecute = options.canExecute ?? ((file: string) => executableFile(file, platform))
  const override = options.executable ?? get('AGY_BIN')
  if (override !== undefined && override.trim()) {
    const file = expand(unquote(override))
    if (!path.isAbsolute(file)) throw new Error('AGY_BIN 必须为 agy 程序的绝对路径，不能是命令或参数。')
    if (platform === 'win32' && !/\.(exe|com|cmd|bat)$/i.test(file)) throw new Error('Windows AGY_BIN 需指向 .exe/.com/.cmd/.bat，不能直接运行 .ps1 或无扩展名的 shell 脚本。')
    if (!canExecute(file)) throw new Error(`AGY_BIN 指定的程序不存在或不可执行：${file}。请修正配置，不会自动改用其他程序。`)
    return file
  }
  const extensions = platform === 'win32'
    ? [...new Set([...(get('PATHEXT') ?? '.EXE;.COM;.CMD;.BAT').split(';').map(value => value.trim().toLowerCase()).filter(value => /^\.(exe|com|cmd|bat)$/.test(value)), '.exe', '.com', '.cmd', '.bat'])]
    : ['']
  const directories = (get('PATH') ?? '').split(platform === 'win32' ? ';' : ':').map(value => expand(unquote(value)))
  if (platform === 'win32') {
    const local = get('LOCALAPPDATA') || win32.join(home, 'AppData', 'Local')
    const roaming = get('APPDATA') || win32.join(home, 'AppData', 'Roaming')
    directories.push(
      win32.join(local, 'agy', 'bin'), win32.join(home, '.local', 'bin'),
      win32.join(local, 'Programs', 'agy'), win32.join(local, 'Programs', 'agy', 'bin'),
      win32.join(roaming, 'npm'),
    )
    for (const name of ['ProgramFiles', 'ProgramW6432']) {
      const base = get(name)
      if (base) directories.push(win32.join(base, 'agy', 'bin'), win32.join(base, 'agy'))
    }
  } else {
    directories.push(
      posix.join(home, '.local', 'bin'), posix.join(home, 'bin'),
      posix.join(home, '.bun', 'bin'),
      ...(platform === 'darwin' ? [posix.join(home, 'Library', 'pnpm')] : []),
      posix.join(home, '.local', 'share', 'pnpm'),
      '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin',
    )
  }
  const seen = new Set<string>()
  for (const directory of directories) {
    if (!directory || !path.isAbsolute(directory)) continue
    const key = platform === 'win32' ? path.normalize(directory).toLowerCase() : path.normalize(directory)
    if (seen.has(key)) continue
    seen.add(key)
    for (const extension of extensions) {
      const file = path.join(directory, `agy${extension}`)
      if (canExecute(file)) return file
    }
  }
  throw new Error(platform === 'win32'
    ? '未找到 agy 可执行文件。已检查 AGY_BIN、PATH、%LOCALAPPDATA%\\agy\\bin、~\\.local\\bin 等安装目录。请用 Get-Command agy 或 where.exe agy 核对安装；自定义安装可设置 AGY_BIN 为绝对路径。安装或修改环境变量后请重新打开 Gamma。不会自动安装或放宽权限。'
    : '未找到 agy 可执行文件。已检查 AGY_BIN、PATH、~/.local/bin 和 Homebrew 等目录。请用 command -v agy 核对安装，或设置 AGY_BIN 为绝对路径后重新打开 Gamma。不会自动安装或放宽权限。')
}

/** 仅继承 CLI 账号/运行时需要的系统环境；不传 Agent 密钥、NODE_OPTIONS 或 Electron 注入。 */
export function createAgyEnvironment(source: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of ['HOME', 'USERPROFILE', 'PATH', 'PATHEXT', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SYSTEMROOT', 'COMSPEC', 'SYSTEMDRIVE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMW6432']) {
    const value = environmentValue(source, name, platform)
    if (value) env[name] = value
  }
  return env
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g
function escapeCmdArgument(value: string): string {
  // 先做 Windows CRT 引号转义，再为 cmd 与 batch 中的 %* 转发分别转义元字符。
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
}

export function createAgyInvocation(executable: string, args: readonly string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): AgyInvocation {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable)) return { command: executable, args }
  if ([executable, ...args].some(value => /[\x00-\x1f\x7f]/.test(value))) throw new Error('agy batch 启动参数不能包含控制字符；JSON Schema 应通过文件传递。')
  const command = environmentValue(env, 'COMSPEC', platform) || win32.join(environmentValue(env, 'SYSTEMROOT', platform) || 'C:\\Windows', 'System32', 'cmd.exe')
  const line = [win32.normalize(executable).replace(CMD_META, '^$1'), ...args.map(escapeCmdArgument)].join(' ')
  return { command, args: ['/d', '/v:off', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true }
}

export function formatAgyLaunchError(error: unknown, executable?: string, cwd?: string, platform: NodeJS.Platform = process.platform): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
  const location = executable ? ` 程序：${executable}。` : ''
  if (code === 'ENOENT') return `无法启动 agy（ENOENT）：选定程序、解释器或工作目录可能已被移动/删除。${location}${cwd ? ` 工作目录：${cwd}。` : ''}请${platform === 'win32' ? '用 Get-Command agy / where.exe agy' : '用 command -v agy'}核对安装，必要时修正 AGY_BIN 后重启 Gamma。`
  if (code === 'EACCES' || code === 'EPERM') return `无法启动 agy（${code}）：请检查程序执行权限或系统安全软件拦截。${location}不会自动提权。`
  if (code === 'ENOEXEC' || code === 'EINVAL' || code === 'UNKNOWN') return `无法启动 agy（${code}）：请检查可执行文件格式、系统架构或 batch 解释器。${location}`
  return `无法启动 agy：${message}`
}
