import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { DESIGN_SOURCE_REVISION, DESIGN_SOURCE_URL } from '@gamma/shared'
import { getConfigDir } from './config-paths'

const execFileAsync = promisify(execFile)
export type DesignBundleKind = 'slides' | 'canvas' | 'system' | 'dashboard' | 'motion'
const SKILLS: Record<DesignBundleKind, string> = {
  slides: 'claude-slides', canvas: 'claude-design', system: 'claude-design-system',
  dashboard: 'claude-dashboard', motion: 'claude-motion',
}
const ALL_SKILLS = [...Object.values(SKILLS), 'dataviz', 'motion-director']
const MARKER = '.gamma-design-revision'
const MAX_BYTES = 256 * 1024 * 1024

export interface DesignBundleStatus {
  installed: boolean
  revision: string
  bundlePath?: string
  nodeVersion: string
  supportsSqlite: boolean
}
export interface DesignCommandOptions { timeoutMs?: number; signal?: AbortSignal }
export interface DesignCommandResult { stdout: string; stderr: string }
export interface DesignExecutionOptions {
  env: NodeJS.ProcessEnv
  cwd?: string
  timeout: number
  maxBuffer: number
  signal?: AbortSignal
}
export interface DesignBundleDependencies {
  /** 测试和独立宿主可指定缓存根，不触碰真实 Gamma 配置或用户 Skills。 */
  installRoot?: string
  fetchSource?: (directory: string) => Promise<string>
  runtimePath?: string
  execute?: (executable: string, args: string[], options: DesignExecutionOptions) => Promise<DesignCommandResult>
}

/** 子进程绝不继承渠道 Key、OAuth token、NODE_OPTIONS 或 Electron 调试配置。 */
function runtimeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

async function execute(executable: string, args: string[], options: DesignExecutionOptions): Promise<DesignCommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { ...options, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error) { Object.assign(error, { stdout, stderr }); reject(error) }
      else resolve({ stdout, stderr })
    })
    // 没有 stdin 协议，立即 EOF，避免上游 readFileSync(0) 永久等待。
    child.stdin?.end()
  })
}

/** 生产优先复用 Electron 自带 Node；Bun 仅是构建/测试宿主，绝不拿它冒充 Node。 */
function resolveRuntimePath(): string {
  if (!process.versions.bun) return process.execPath
  const electron: unknown = require('electron')
  if (typeof electron === 'string' && isAbsolute(electron)) return electron
  throw new Error('未找到可运行 design 的 Electron/Node 22+ 环境')
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** 限制下载后的运行内容；禁止链接、设备、深层目录和超大单文件/总包。 */
async function assertRegularTree(root: string, budget = { bytes: 0, count: 0 }): Promise<void> {
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 40 || ++budget.count > 30_000) throw new Error('design 运行包超出目录数量/深度限制')
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('design 运行包不允许符号链接')
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name), depth + 1)
    } else if (stat.isFile()) {
      budget.bytes += stat.size
      if (stat.size > 64 * 1024 * 1024 || budget.bytes > MAX_BYTES) throw new Error('design 运行包超出安全大小限制')
    } else throw new Error('design 运行包包含非普通文件')
  }
  await visit(root, 0)
}

/** 仅下载固定提交的七个技能与宿主参考 lib，不下载 archive，不运行安装 hooks。 */
export async function fetchDesignBundleSource(directory: string): Promise<string> {
  const repo = join(directory, 'source')
  const env = { ...runtimeEnvironment(), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }
  const options = { env, timeout: 180_000, maxBuffer: 1024 * 1024, windowsHide: true }
  const config = ['-c', 'core.hooksPath=', '-c', 'credential.helper=', '-c', 'protocol.file.allow=never']
  await execFileAsync('git', [...config, 'init', repo], options)
  const git = async (args: string[]): Promise<string> => {
    const result = await execFileAsync('git', ['-C', repo, ...config, ...args], options)
    return result.stdout.trim()
  }
  await git(['remote', 'add', 'origin', `${DESIGN_SOURCE_URL}.git`])
  await git(['fetch', '--depth=1', '--filter=blob:none', 'origin', DESIGN_SOURCE_REVISION])
  await git(['sparse-checkout', 'set', ...ALL_SKILLS.map((name) => `skills/${name}`), 'dsh-plugins/dsh-claude-artifacts/lib'])
  await git(['checkout', '--detach', 'FETCH_HEAD'])
  if (await git(['rev-parse', 'HEAD']) !== DESIGN_SOURCE_REVISION) throw new Error('design 下载 revision 不匹配')
  return repo
}

async function assertBundleFiles(bundle: string): Promise<void> {
  for (const skill of ALL_SKILLS) {
    const path = join(bundle, 'skills', skill, 'SKILL.md')
    if (!(await lstat(path)).isFile()) throw new Error(`design 缺少 Skill: ${skill}`)
    const text = await readFile(path, 'utf8')
    if (!new RegExp(`^name:\\s*${skill}\\s*$`, 'm').test(text)) throw new Error(`design Skill 名称不匹配: ${skill}`)
  }
  for (const skill of Object.values(SKILLS)) {
    for (const file of ['artifact.mjs', 'editor/index.html', 'editor/third-party-licenses.txt']) {
      if (!(await lstat(join(bundle, 'skills', skill, 'scripts', file))).isFile()) throw new Error(`design 编辑器不完整: ${skill}/${file}`)
    }
  }
  for (const file of ['LICENSE', 'NOTICE.md', 'dsh-plugins/dsh-claude-artifacts/lib/index.js', 'dsh-plugins/dsh-claude-artifacts/lib/client.js']) {
    if (!(await lstat(join(bundle, file))).isFile()) throw new Error(`design 缺少运行包文件: ${file}`)
  }
}

const COMMON_COMMANDS = ['open', 'stop', 'check', 'upload', 'comments', 'comment-reply', 'comment-resolve', 'archive', 'help']
const FLAGS: Record<string, Record<string, boolean>> = {
  open: { port: true, host: true }, stop: {}, check: {},
  upload: { group: true, name: true }, comments: { all: false, wait: false, timeout: true },
  'comment-reply': { resolve: false }, 'comment-resolve': { reopen: false }, archive: { out: true },
  help: {}, list: {}, 'ds-sync': { check: false, from: true },
  'write-db': {}, 'read-db': { text: false }, 'delete-asset': {},
}

/** 必须先于下载、探测、执行检查；不允许 shell hook、任意 serve、LAN 或付费专用命令。 */
function validateCommand(kind: DesignBundleKind, args: string[]): string | undefined {
  if (!Object.hasOwn(SKILLS, kind)) throw new Error('不支持的 design 类型')
  const command = args[0]
  const allowed = [...COMMON_COMMANDS]
  if (kind === 'slides' || kind === 'canvas' || kind === 'system' || kind === 'motion') allowed.push('list')
  if (kind === 'slides' || kind === 'canvas') allowed.push('ds-sync')
  if (kind === 'dashboard' || kind === 'motion') allowed.push('read-db', 'write-db', 'delete-asset')
  if (!command || !allowed.includes(command)) throw new Error(`不允许的 design 命令: ${command ?? ''}`)
  if (args.length > 100 || args.some((arg) => typeof arg !== 'string' || arg.includes('\0') || arg.length > 128_000)) throw new Error('design 命令参数超出限制')
  const positional: string[] = []
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('-')) { positional.push(arg); continue }
    if (!arg.startsWith('--') || arg.includes('=')) throw new Error(`不允许的 design 参数: ${arg}`)
    const flag = arg.slice(2)
    const rules = FLAGS[command]!
    if (!Object.hasOwn(rules, flag)) throw new Error(`不允许的 design 参数: ${arg}`)
    if (rules[flag]) {
      const value = args[++i]
      if (!value || value.startsWith('-')) throw new Error(`design 参数缺少值: ${arg}`)
      if (flag === 'host' && value !== '127.0.0.1') throw new Error('design 只允许监听 127.0.0.1')
      if (flag === 'port' && (!/^\d+$/.test(value) || Number(value) > 65535)) throw new Error('design 端口无效')
    }
  }
  if (command !== 'help' && command !== 'list' && (!positional[0] || !isAbsolute(positional[0]))) throw new Error('design 作品根必须是调用方已授权的绝对路径')
  if (command === 'list' && (!positional.length || positional.some((path) => !isAbsolute(path)))) throw new Error('design list 必须显式指定已授权的绝对目录')
  return command === 'help' || command === 'list' ? undefined : positional[0]
}

/** 独立服务实例用于测试依赖注入；默认实例不写工作区 Skill。 */
export function createDesignBundleService(deps: DesignBundleDependencies = {}) {
  const run = deps.execute ?? execute
  const root = () => deps.installRoot ?? join(getConfigDir(), 'cache', 'design-bundles')
  const target = () => join(root(), DESIGN_SOURCE_REVISION)
  let installing: Promise<DesignBundleStatus> | undefined
  let runtimeProbe: Promise<{ nodeVersion: string; supportsSqlite: boolean; executable?: string }> | undefined
  const probeRuntime = () => runtimeProbe ??= (async () => {
    try {
      const executable = deps.runtimePath ?? resolveRuntimePath()
      const script = 'let ok=false;try{const {DatabaseSync}=await import("node:sqlite");const d=new DatabaseSync(":memory:");ok=d.prepare("select 1 as n").get().n===1;d.close()}catch{};console.log(JSON.stringify({nodeVersion:process.versions.node,supportsSqlite:ok&&!process.versions.bun}))'
      const result = await run(executable, ['--input-type=module', '-e', script], { env: runtimeEnvironment(), timeout: 10_000, maxBuffer: 1024 * 1024 })
      const value: unknown = JSON.parse(result.stdout.trim())
      if (!value || typeof value !== 'object' || !('nodeVersion' in value) || typeof value.nodeVersion !== 'string' || !('supportsSqlite' in value) || typeof value.supportsSqlite !== 'boolean') throw new Error('Node 探测返回无效数据')
      return { nodeVersion: value.nodeVersion, supportsSqlite: value.supportsSqlite && Number(value.nodeVersion.split('.')[0]) >= 22, executable }
    } catch { return { nodeVersion: 'unavailable', supportsSqlite: false } }
  })()
  async function getDesignBundleStatus(): Promise<DesignBundleStatus> {
    const runtime = await probeRuntime()
    let installed = false
    if (await exists(target())) {
      try {
        const stat = await lstat(target())
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('design 运行包目录无效')
        if ((await readFile(join(target(), MARKER), 'utf8')).trim() !== DESIGN_SOURCE_REVISION) throw new Error('design revision 不匹配')
        await assertBundleFiles(target())
        installed = true
      } catch { /* 损坏缓存不视为已安装，也不会静默覆盖。 */ }
    }
    return { installed, revision: DESIGN_SOURCE_REVISION, ...(installed ? { bundlePath: target() } : {}), nodeVersion: runtime.nodeVersion, supportsSqlite: runtime.supportsSqlite }
  }
  async function install(accepted: boolean): Promise<DesignBundleStatus> {
    if (accepted !== true) throw new Error('安装前必须确认第三方混合许可与运行第三方代码')
    const status = await getDesignBundleStatus()
    if (status.installed) return status
    if (!status.supportsSqlite) throw new Error(`design 需要支持 node:sqlite 的 Node 22+，当前: ${status.nodeVersion}`)
    await mkdir(root(), { recursive: true })
    const lock = join(root(), `.${DESIGN_SOURCE_REVISION}.lock`)
    try { await mkdir(lock) } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new Error('design 运行包正在安装，或上次进程中断留下安装锁；请稍后重试/检查锁')
      throw error
    }
    let staging: string | undefined
    try {
      const current = await getDesignBundleStatus()
      if (current.installed) return current
      if (await exists(target())) throw new Error('同 revision 的 design 缓存已存在但不完整，不会覆盖；请先检查缓存')
      staging = await mkdtemp(join(root(), '.install-'))
      const source = await (deps.fetchSource ?? fetchDesignBundleSource)(staging)
      const prepared = join(staging, 'bundle')
      await mkdir(join(prepared, 'skills'), { recursive: true })
      // 先检查所有将复制的内容，cp 不可跟随下载内容中的 symlink。
      const paths = [...ALL_SKILLS.map((name) => `skills/${name}`), 'dsh-plugins/dsh-claude-artifacts/lib', 'LICENSE', 'NOTICE.md']
      for (const path of [source, join(source, 'skills'), join(source, 'dsh-plugins'), join(source, 'dsh-plugins', 'dsh-claude-artifacts')]) {
        const stat = await lstat(path)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('design 来源父目录必须是普通目录，不允许符号链接')
      }
      const budget = { bytes: 0, count: 0 }
      for (const path of paths) await assertRegularTree(join(source, path), budget)
      for (const path of paths) {
        const destination = join(prepared, path)
        await mkdir(join(destination, '..'), { recursive: true })
        await cp(join(source, path), destination, { recursive: true, force: false, errorOnExist: true, dereference: false })
      }
      await assertRegularTree(prepared)
      await assertBundleFiles(prepared)
      // 非 JSON 的提交标记随整个目录原子发布，不产生半安装运行包。
      await writeFile(join(prepared, MARKER), `${DESIGN_SOURCE_REVISION}\n`, { flag: 'wx' })
      if (await exists(target())) throw new Error('design 安装目标已存在，不会覆盖')
      await rename(prepared, target())
      return await getDesignBundleStatus()
    } finally {
      try { if (staging) await rm(staging, { recursive: true, force: true }) }
      finally { await rm(lock, { recursive: true, force: true }) }
    }
  }
  async function installDesignBundle(acceptedThirdPartyCode: boolean): Promise<DesignBundleStatus> {
    // 即使已有并发安装，未确认调用方也不能加入它。
    if (acceptedThirdPartyCode !== true) throw new Error('安装前必须确认第三方混合许可与运行第三方代码')
    if (!installing) installing = install(true).finally(() => { installing = undefined })
    return installing
  }
  async function getDesignBundleSkillPath(kind: DesignBundleKind): Promise<string> {
    if (!Object.hasOwn(SKILLS, kind)) throw new Error('不支持的 design 类型')
    const status = await getDesignBundleStatus()
    if (!status.installed || !status.bundlePath) throw new Error('完整 design 运行包尚未安装')
    return join(status.bundlePath, 'skills', SKILLS[kind])
  }
  async function runDesignArtifactCommand(kind: DesignBundleKind, args: string[], options: DesignCommandOptions = {}): Promise<DesignCommandResult> {
    const artifactRoot = validateCommand(kind, args)
    if (options.signal?.aborted) throw new Error('design 命令已取消')
    const timeout = options.timeoutMs ?? 60_000
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600_000) throw new Error('design 命令超时必须在 1–600000 ms 之间')
    const skill = await getDesignBundleSkillPath(kind)
    const runtime = await probeRuntime()
    if (!runtime.executable || !runtime.supportsSqlite) throw new Error('design 需要支持 node:sqlite 的 Node 22+')
    return run(runtime.executable, [join(skill, 'scripts', 'artifact.mjs'), ...args], {
      // 上游 write-db 的 file_path 等相对路径应以已授权作品根解析。
      env: runtimeEnvironment(), cwd: artifactRoot ?? target(), timeout, maxBuffer: 8 * 1024 * 1024, signal: options.signal,
    })
  }
  return { getDesignBundleStatus, installDesignBundle, getDesignBundleSkillPath, runDesignArtifactCommand }
}

const defaultService = createDesignBundleService()
export const getDesignBundleStatus = defaultService.getDesignBundleStatus
export const installDesignBundle = defaultService.installDesignBundle
export const getDesignBundleSkillPath = defaultService.getDesignBundleSkillPath
export const runDesignArtifactCommand = defaultService.runDesignArtifactCommand
