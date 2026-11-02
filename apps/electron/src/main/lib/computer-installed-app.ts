import { execFile } from 'node:child_process'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const MAX_PLIST_BYTES = 1_048_576
const MAX_BUNDLES = 512
const MAX_DEPTH = 2

export interface InstalledComputerApp {
  appName: string
  bundleId: string
}
/** 仅主进程可信调用方可注入；不接收模型提供的目录或读取器。 */
export interface InstalledComputerAppOptions {
  roots?: readonly string[]
  reader?: (plistPath: string, signal: AbortSignal) => Promise<unknown>
  maxEntries?: number
  timeoutMs?: number
}

function installationRoots(): string[] {
  return [
    '/Applications',
    '/System/Applications',
    '/System/Library/CoreServices/Applications',
    join(homedir(), 'Applications'),
    '/System/Cryptexes/App/System/Applications',
    '/System/Volumes/Preboot/Cryptexes/App/System/Applications',
  ]
}
const key = (value: string): string => value.trim().toLowerCase()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const missing = (error: unknown): boolean => record(error) && error.code === 'ENOENT'
function label(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= 256 && !/[\x00-\x1f\x7f/]/.test(value)
    ? value.trim() : undefined
}
async function readPlist(path: string, signal: AbortSignal): Promise<unknown> {
  const execution = { encoding: 'utf8' as const, timeout: 1000, maxBuffer: MAX_PLIST_BYTES, signal }
  try {
    const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', path], execution)
    return JSON.parse(stdout) as unknown
  } catch {
    if (signal.aborted) throw new Error('安装身份读取已取消')
  }
  // Stocks 等系统 plist 含 JSON 不支持的 date/data。plutil 不支持 JSON 标量，
  // 因此仅提取三个 string 字段，构成最小内存 plist 后交回 plutil 转换 JSON。
  // 全程 stdin/stdout，不写临时文件，也不启动目标应用。
  const fields = ['CFBundleIdentifier', 'CFBundleName', 'CFBundleDisplayName'] as const
  const escapeXml = (value: string): string => value.replace(/[<>&"']/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]!)
  const values = await Promise.all(fields.map(async field => {
    try {
      const { stdout } = await exec('/usr/bin/plutil', ['-extract', field, 'raw', '-expect', 'string', '-n', '-o', '-', '--', path], {
        ...execution, maxBuffer: 4096,
      })
      return `<key>${field}</key><string>${escapeXml(stdout)}</string>`
    } catch {
      return ''
    }
  }))
  if (signal.aborted) throw new Error('安装身份读取已取消')
  const conversion = exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], execution)
  // stdin 的异步关闭错误交由子进程退出状态处理，避免取消引起未处理 EPIPE。
  conversion.child.stdin?.on('error', () => {})
  conversion.child.stdin?.end(`<?xml version="1.0"?><plist version="1.0"><dict>${values.join('')}</dict></plist>`)
  return JSON.parse((await conversion).stdout) as unknown
}

/**
 * 只解析安装身份，不授予权限、不启动应用。扫描仅限 Applications 安装根及两层分类目录，
 * 不进入 bundle、隐藏目录或符号链接；InfoPlist.strings 和系统本地化别名不在支持范围内。
 * 读取失败、预算耗尽或身份不完整均失败关闭，不能把部分扫描误认为唯一匹配。
 */
export async function resolveInstalledComputerApp(
  identifier: string,
  platform: NodeJS.Platform = process.platform,
  options: InstalledComputerAppOptions = {},
): Promise<InstalledComputerApp | undefined> {
  if (platform !== 'darwin' || typeof identifier !== 'string' || !identifier.trim()
    || identifier.length > 1024 || /[\x00-\x1f\x7f]/.test(identifier)) return undefined
  const requested = identifier.trim()
  const roots = options.roots ?? installationRoots()
  const maxEntries = options.maxEntries ?? 4096
  const timeoutMs = options.timeoutMs ?? 5000
  if (roots.length > 8 || roots.some(root => !isAbsolute(root))
    || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return undefined
  const pathRequest = requested.includes(sep)
  if (pathRequest && (!isAbsolute(requested) || normalize(requested) !== requested
    || !roots.some(root => requested.startsWith(`${normalize(root)}${sep}`)))) return undefined
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<undefined>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(undefined) }, timeoutMs)
  })
  const scan = async (): Promise<InstalledComputerApp | undefined> => {
    let entries = 0
    let bundles = 0
    const seenRoots = new Set<string>()
    const seenBundles = new Set<string>()
    const matches = new Map<string, InstalledComputerApp>()
    const assertBudget = (): void => {
      if (controller.signal.aborted) throw new Error('已安装应用解析超时')
    }
    const visit = async (directory: string, depth: number): Promise<void> => {
      assertBudget()
      const handle = await opendir(directory)
      for await (const entry of handle) {
        assertBudget()
        if (++entries > maxEntries) throw new Error('已安装应用解析超出条目上限')
        // 非 .app 的备份包也可能留在 Applications；不进入它们的 Contents 载荷。
        if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'contents' || entry.isSymbolicLink() || !entry.isDirectory()) continue
        const path = join(directory, entry.name)
        if (!entry.name.toLowerCase().endsWith('.app')) {
          if (depth >= MAX_DEPTH) throw new Error('安装目录超过扫描深度，不能证明身份唯一')
          await visit(path, depth + 1)
          continue
        }
        if (seenBundles.has(path)) continue
        seenBundles.add(path)
        if (++bundles > MAX_BUNDLES) throw new Error('已安装应用解析超出 bundle 上限')
        // 路径请求只读取自身的元数据，不读取其他应用以推断路径别名。
        if (pathRequest && path !== requested) continue
        const bundle = await lstat(path)
        const contents = await lstat(join(path, 'Contents'))
        const plistPath = join(path, 'Contents', 'Info.plist')
        const plist = await lstat(plistPath)
        if (!bundle.isDirectory() || bundle.isSymbolicLink() || !contents.isDirectory() || contents.isSymbolicLink()
          || !plist.isFile() || plist.isSymbolicLink() || plist.size > MAX_PLIST_BYTES) throw new Error('安装身份路径不可信')
        const raw = await (options.reader ?? readPlist)(plistPath, controller.signal)
        assertBudget()
        if (!record(raw)) throw new Error('安装身份不是 plist 字典')
        const bundleId = label(raw.CFBundleIdentifier)
        const name = label(raw.CFBundleName)
        const displayName = label(raw.CFBundleDisplayName)
        if (!bundleId || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(bundleId) || (!name && !displayName)) {
          throw new Error('安装身份不完整')
        }
        const aliases = [bundleId, name, displayName, entry.name, basename(path).slice(0, -4)]
        if (pathRequest || aliases.some(alias => alias !== undefined && key(alias) === key(requested))) {
          matches.set(key(bundleId), { appName: displayName ?? name!, bundleId })
        }
      }
    }
    for (const root of roots) {
      assertBudget()
      let canonical: string
      try {
        const info = await lstat(root)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('安装根目录不可信')
        canonical = await realpath(root)
      } catch (error: unknown) {
        if (missing(error)) continue
        throw error
      }
      if (seenRoots.has(canonical)) continue
      seenRoots.add(canonical)
      // 保留用户指定的受限根路径进行匹配；canonical 仅用于去重。
      await visit(normalize(root), 0)
    }
    return matches.size === 1 ? matches.values().next().value : undefined
  }
  try {
    return await Promise.race([scan().catch(() => undefined), timedOut])
  } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}
