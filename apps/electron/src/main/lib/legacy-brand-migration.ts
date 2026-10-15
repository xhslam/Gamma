/**
 * 首次从 Proma 升级到 Gamma 时复制应用拥有的数据。
 * 旧目录始终保留；只有完成凭据与浏览器迁移的 staging 才会成为正式配置。
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { writeTextFileAtomic } from './safe-file'

export const LEGACY_MIGRATION_MARKER = 'gamma-brand-migration.json'
const MIGRATION_VERSION = 1
const SECRET_PREFIX = 'safeStorage:v1:'
const PROFILE_TRANSIENT_FILES = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'])
const USER_CONTENT_KEYS = new Set(['content', 'text', 'prompt', 'systemPrompt', 'description', 'body', 'projectRootPath', 'projectPath', 'arguments', 'input', 'toolInput'])

export interface LegacyBrandMigrationOptions {
  homeDirectory: string
  appDataDirectory: string
  isDevelopment: boolean
  instance?: string
}

export interface LegacyBrandMigrationPaths {
  legacyConfigDirectory: string
  configDirectory: string
  profileDirectory: string
  legacyProfileCandidates: string[]
}

export interface LegacyMigrationMarker {
  version: typeof MIGRATION_VERSION
  sourceConfigDirectory: string
  sourceProfileDirectory?: string
  status: 'profile-pending' | 'complete'
}

export interface LegacyCredentialSlot {
  filePath: string
  document: object
  object: Record<string, unknown>
  key: string
  ciphertext: string
  prefix: string
}

export interface PreparedLegacyBrandMigration {
  paths: LegacyBrandMigrationPaths
  legacyProfileDirectory?: string
  stagingConfigDirectory?: string
  legacyProfileSnapshot?: string
  profileNeedsMigration: boolean
  configNeedsMigration: boolean
  commit(): void
  dispose(): void
}

export function getLegacyBrandMigrationPaths(options: LegacyBrandMigrationOptions): LegacyBrandMigrationPaths {
  const suffix = options.isDevelopment ? '-dev' : ''
  const instanceSuffix = options.isDevelopment && options.instance ? `-${options.instance}` : ''
  const oldNames = options.isDevelopment
    ? [`@proma/electron-dev${instanceSuffix}`]
    : ['@proma/electron', 'Proma']
  return {
    legacyConfigDirectory: join(options.homeDirectory, `.proma${suffix}`),
    configDirectory: join(options.homeDirectory, `.gamma${suffix}`),
    profileDirectory: join(options.appDataDirectory, options.isDevelopment ? `@gamma/electron-dev${instanceSuffix}` : 'Gamma'),
    legacyProfileCandidates: oldNames.map((name) => join(options.appDataDirectory, name)),
  }
}

function readMarker(directory: string): LegacyMigrationMarker | undefined {
  try {
    const value = JSON.parse(readFileSync(join(directory, LEGACY_MIGRATION_MARKER), 'utf-8')) as Partial<LegacyMigrationMarker>
    if (value.version === MIGRATION_VERSION && typeof value.sourceConfigDirectory === 'string' && (value.status === 'complete' || value.status === 'profile-pending')) return value as LegacyMigrationMarker
  } catch { /* 没有有效的迁移标记时，目录属于用户，不能覆盖。 */ }
  return undefined
}

function assertPlainDirectory(directory: string): void {
  let stat: ReturnType<typeof lstatSync>
  try { stat = lstatSync(directory) } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`迁移目录必须是真实目录，不能是链接或文件：${directory}`)
}

export function findLegacyProfileDirectory(paths: LegacyBrandMigrationPaths): string | undefined {
  const candidates = paths.legacyProfileCandidates.filter((candidate) => existsSync(candidate))
  for (const candidate of candidates) assertPlainDirectory(candidate)
  if (candidates.length > 1) throw new Error('发现多个 Proma 浏览器数据目录；请先保留备份并整理旧目录，Gamma 不会自动合并它们。')
  return candidates[0]
}

/** 只更新实际位于旧受管根内的绝对路径，用户项目根和消息正文由上层排除。 */
export function migrateLegacyManagedPath(value: string, sourceRoot: string, targetRoot: string): string {
  if (value.startsWith('proma-file://')) return `gamma-file://${value.slice('proma-file://'.length)}`
  if (value.startsWith('file://')) {
    try {
      const path = fileURLToPath(value)
      const next = migrateLegacyManagedPath(path, sourceRoot, targetRoot)
      return next === path ? value : pathToFileURL(next).toString()
    } catch { return value }
  }
  const sources = [resolve(sourceRoot)]
  if (existsSync(sourceRoot)) sources.push(realpathSync(sourceRoot))
  for (const source of sources) {
    if (value === source || value.startsWith(source + sep)) return resolve(targetRoot) + value.slice(source.length)
  }
  return value
}

export function migrateLegacyMetadata(value: unknown, sourceRoot: string, targetRoot: string, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => migrateLegacyMetadata(item, sourceRoot, targetRoot, parentKey))
  if (typeof value === 'string') {
    if (parentKey === 'outputMode' && value === 'proma-input') return 'gamma-input'
    if (/path|directory|dir$|^cwd$|^url$|^src$|^piSessionFile$|^parentSession$|^mainRepoRoot$|^attachedFiles$|^attachedDirectories$/i.test(parentKey)) return migrateLegacyManagedPath(value, sourceRoot, targetRoot)
    return value
  }
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const migrated: Record<string, unknown> = {}
  const ownedCoachActivation = parentKey === 'skill_activations' && record.slug === 'proma-coach' && (
    typeof record.filePath === 'string' && migrateLegacyManagedPath(record.filePath, sourceRoot, targetRoot) !== record.filePath ||
    typeof record.workspaceSlug === 'string' && typeof record.workspaceSkillPath === 'string' && /^proma-coach[\\/]/.test(record.workspaceSkillPath)
  )
  for (const [key, item] of Object.entries(record)) {
    const nextKey = key.startsWith('_proma') ? `_gamma${key.slice('_proma'.length)}` : key === 'promaLogoId' ? 'gammaLogoId' : key === 'isPromaManaged' ? 'isGammaManaged' : key
    // 内容块、工具参数和用户指定的项目根不属于应用元数据。
    if (ownedCoachActivation && (key === 'slug' || key === 'name') && item === 'proma-coach') migrated[nextKey] = 'gamma-coach'
    else if (ownedCoachActivation && key === 'workspaceSkillPath' && typeof item === 'string') migrated[nextKey] = item.replace(/^proma-coach([\\/])/, 'gamma-coach$1')
    else if (ownedCoachActivation && key === 'filePath' && typeof item === 'string') migrated[nextKey] = migrateLegacyManagedPath(item, sourceRoot, targetRoot).replace(/([\\/](?:skills|skills-inactive)[\\/])proma-coach([\\/])/, '$1gamma-coach$2')
    else if (USER_CONTENT_KEYS.has(key)) migrated[nextKey] = item
    else if (key === 'kind' && item === 'proma_event' && (parentKey === 'runtimeEnvelope' || 'event' in record)) migrated[nextKey] = 'gamma_event'
    else migrated[nextKey] = migrateLegacyMetadata(item, sourceRoot, targetRoot, key)
  }
  return migrated
}

function isOwnedMetadataFile(path: string, root: string): boolean {
  const segments = relative(root, path).split(sep)
  if (!/\.json(?:l)?(?:\.bak|\.tmp)?$/.test(segments.at(-1) ?? '')) return false
  if (segments.length === 1) return true
  if (['agent-sessions', 'sdk-config'].includes(segments[0]!)) return true
  return segments[0] === 'agent-workspaces' && segments.length === 3 && /^(?:mcp|config)\.json(?:\.bak|\.tmp)?$/.test(segments[2]!)
}

function migrateCopiedMetadata(root: string, sourceRoot: string, targetRoot: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = relative(root, path).split(sep)
      // 已退役的 Chat 历史仅原样复制，不解析、改写或检查其内部路径。
      if (relativePath[0] === 'conversations' || relativePath.length === 1 && /^(?:conversations|system-prompts|chat-tools)\.json(?:\.bak|\.tmp)?$/.test(entry.name)) continue
      if (entry.isSymbolicLink()) {
        const segments = relative(root, path).split(sep)
        if (isOwnedMetadataFile(path, root) || ['agent-sessions', 'sdk-config'].includes(segments[0]!) || segments[0] === 'agent-workspaces' && segments.length <= 2) {
          throw new Error('应用配置或会话元数据含符号链接，迁移已停止；旧数据和外部文件均未改动。请先将这些元数据整理为普通文件。')
        }
        const original = readlinkSync(path)
        const next = migrateLegacyManagedPath(original, sourceRoot, targetRoot)
        if (next !== original) { unlinkSync(path); symlinkSync(next, path) }
      } else if (entry.isDirectory()) {
        // 用户文件、Skills、记忆正文和外部项目不参与元数据扫描。
        const first = relative(root, path).split(sep)[0]
        if (['agent-sessions', 'sdk-config', 'agent-workspaces'].includes(first!)) visit(path)
      } else if (entry.isFile() && isOwnedMetadataFile(path, root)) {
        const original = readFileSync(path, 'utf-8')
        if (/\.jsonl(?:\.bak|\.tmp)?$/.test(path)) {
          const next = original.split('\n').map((line) => {
            if (!line.trim()) return line
            try { return JSON.stringify(migrateLegacyMetadata(JSON.parse(line) as unknown, sourceRoot, targetRoot)) }
            catch { return line } // 原有损坏行原样保留，交给现有会话恢复逻辑处理。
          }).join('\n')
          if (next !== original) writeTextFileAtomic(path, next)
        } else {
          try {
            const parsed = JSON.parse(original) as unknown
            const migrated = migrateLegacyMetadata(parsed, sourceRoot, targetRoot)
            if (JSON.stringify(parsed) !== JSON.stringify(migrated)) writeTextFileAtomic(path, JSON.stringify(migrated, null, 2))
          } catch { /* 损坏的主文件及 backup 都保留，不能以空对象覆盖。 */ }
        }
      }
    }
  }
  visit(root)
}

export function copyLegacyProfile(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (path) => {
      if (PROFILE_TRANSIENT_FILES.has(basename(path))) return false
      if (lstatSync(path).isSymbolicLink()) throw new Error('旧浏览器数据含符号链接，自动迁移已停止，以免写入旧数据或外部文件。')
      return true
    },
  })
}

/** Git 管理文件中的受管绝对路径需要随根目录一起更新；跨边界引用不能自动改用户仓库。 */
function migrateCopiedGitPointers(root: string, sourceRoot: string, targetRoot: string): void {
  const canonicalSource = realpathSync(sourceRoot)
  const mapGitPath = (value: string): string => {
    const mapped = migrateLegacyManagedPath(value, sourceRoot, targetRoot)
    return mapped === value ? migrateLegacyManagedPath(value, canonicalSource, targetRoot) : mapped
  }
  const visit = (directory: string, insideGit = false): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        if (entry.name === '.git' || insideGit) throw new Error('受管 Git 管理文件含符号链接，迁移已停止；旧仓库没有被改动。')
        continue
      }
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { visit(path, insideGit || entry.name === '.git'); continue }
      if (!entry.isFile() || !(entry.name === '.git' || insideGit && ['gitdir', 'commondir', 'config', 'config.worktree'].includes(entry.name))) continue
      const original = readFileSync(path, 'utf-8')
      let next = original
      if (entry.name === '.git' || entry.name === 'gitdir' || entry.name === 'commondir') {
        const prefix = entry.name === '.git' ? 'gitdir: ' : ''
        const value = entry.name === '.git' ? original.match(/^gitdir:\s*(.+)\s*$/m)?.[1] : original.trim()
        if (!value) continue
        const oldDirectory = resolve(sourceRoot, relative(root, dirname(path)))
        const pointedPath = resolve(oldDirectory, value)
        if (mapGitPath(pointedPath) === pointedPath) throw new Error('受管 Git worktree 仍引用外部仓库或外部工作树。请先用 git worktree move 整理位置，再启动 Gamma；原仓库没有被改动。')
        const migrated = mapGitPath(value)
        if (migrated !== value) next = `${prefix}${migrated}\n`
      } else {
        next = original.replace(/^(\s*worktree\s*=\s*)(.+)$/gm, (_match: string, prefix: string, value: string) => prefix + mapGitPath(value.trim()))
      }
      if (next !== original) writeTextFileAtomic(path, next)
    }
  }
  visit(root)
}

/** 新 partition 前缀与旧前缀使用同一工作区 digest，改目录名即可保留 LocalStorage。 */
function migrateProfilePartitionDirectories(profile: string): void {
  const partitions = join(profile, 'Partitions')
  if (!existsSync(partitions)) return
  assertPlainDirectory(partitions)
  for (const entry of readdirSync(partitions, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('proma-browser-')) continue
    const target = join(partitions, `gamma-browser-${entry.name.slice('proma-browser-'.length)}`)
    if (existsSync(target)) throw new Error('旧浏览器 partition 与新名称冲突，迁移已停止。')
    renameSync(join(partitions, entry.name), target)
  }
}

export function prepareLegacyBrandMigration(paths: LegacyBrandMigrationPaths): PreparedLegacyBrandMigration {
  for (const directory of [paths.configDirectory, paths.profileDirectory]) assertPlainDirectory(directory)
  const completed = isLegacyBrandMigrationComplete(paths)
  if (completed) return { paths, profileNeedsMigration: false, configNeedsMigration: false, commit: () => {}, dispose: () => {} }
  assertPlainDirectory(paths.legacyConfigDirectory)
  const legacyProfileDirectory = findLegacyProfileDirectory(paths)
  const configNeedsMigration = existsSync(paths.legacyConfigDirectory) && !completed
  if (configNeedsMigration && existsSync(paths.configDirectory)) throw new Error(`旧配置与 Gamma 配置同时存在。已保留两份数据，未合并或覆盖：${paths.configDirectory}`)
  const profileMarker = readMarker(paths.profileDirectory)
  const profileNeedsMigration = Boolean(legacyProfileDirectory && !completed && profileMarker?.status !== 'complete')
  if (profileNeedsMigration && existsSync(paths.profileDirectory) && (profileMarker?.status !== 'profile-pending' || profileMarker.sourceConfigDirectory !== paths.legacyConfigDirectory || profileMarker.sourceProfileDirectory !== legacyProfileDirectory)) {
    throw new Error('旧浏览器数据与已有 Gamma 浏览器数据同时存在。已停止迁移并保留两份数据。')
  }
  const marker: LegacyMigrationMarker = { version: MIGRATION_VERSION, sourceConfigDirectory: paths.legacyConfigDirectory, ...(legacyProfileDirectory ? { sourceProfileDirectory: legacyProfileDirectory } : {}), status: 'profile-pending' }
  let stagingConfigDirectory: string | undefined
  let legacyProfileSnapshot: string | undefined
  try {
    if (legacyProfileDirectory && (profileNeedsMigration || configNeedsMigration)) {
      legacyProfileSnapshot = mkdtempSync(join(tmpdir(), 'gamma-legacy-snapshot-'))
      copyLegacyProfile(legacyProfileDirectory, legacyProfileSnapshot)
    }
    if (profileNeedsMigration && !existsSync(paths.profileDirectory)) {
      mkdirSync(dirname(paths.profileDirectory), { recursive: true })
      const stagingProfile = mkdtempSync(join(dirname(paths.profileDirectory), '.gamma-profile-migration-'))
      try {
        copyLegacyProfile(legacyProfileSnapshot!, stagingProfile)
        migrateProfilePartitionDirectories(stagingProfile)
        writeTextFileAtomic(join(stagingProfile, LEGACY_MIGRATION_MARKER), JSON.stringify(marker, null, 2))
        if (existsSync(paths.profileDirectory)) throw new Error('迁移期间 Gamma 浏览器目录已被其他进程创建。')
        renameSync(stagingProfile, paths.profileDirectory)
      } finally { if (existsSync(stagingProfile)) rmSync(stagingProfile, { recursive: true, force: true }) }
    }
    if (configNeedsMigration) {
      stagingConfigDirectory = mkdtempSync(join(dirname(paths.configDirectory), '.gamma-config-migration-'))
      cpSync(paths.legacyConfigDirectory, stagingConfigDirectory, { recursive: true, dereference: false, verbatimSymlinks: true })
      migrateCopiedMetadata(stagingConfigDirectory, paths.legacyConfigDirectory, paths.configDirectory)
      migrateCopiedGitPointers(stagingConfigDirectory, paths.legacyConfigDirectory, paths.configDirectory)
    }
  } catch (error) {
    if (stagingConfigDirectory) rmSync(stagingConfigDirectory, { recursive: true, force: true })
    if (legacyProfileSnapshot) rmSync(legacyProfileSnapshot, { recursive: true, force: true })
    throw error
  }
  return {
    paths, legacyProfileDirectory, stagingConfigDirectory, legacyProfileSnapshot, profileNeedsMigration, configNeedsMigration,
    commit: () => {
      const completeMarker: LegacyMigrationMarker = { ...marker, status: 'complete' }
      if (stagingConfigDirectory) {
        if (existsSync(paths.configDirectory)) throw new Error('迁移期间 Gamma 配置目录已被创建，旧数据未覆盖。')
        writeTextFileAtomic(join(stagingConfigDirectory, LEGACY_MIGRATION_MARKER), JSON.stringify(completeMarker, null, 2))
        renameSync(stagingConfigDirectory, paths.configDirectory)
        stagingConfigDirectory = undefined
      }
      if (profileNeedsMigration) writeTextFileAtomic(join(paths.profileDirectory, LEGACY_MIGRATION_MARKER), JSON.stringify(completeMarker, null, 2))
    },
    dispose: () => {
      if (stagingConfigDirectory && existsSync(stagingConfigDirectory)) rmSync(stagingConfigDirectory, { recursive: true, force: true })
      if (legacyProfileSnapshot && existsSync(legacyProfileSnapshot)) rmSync(legacyProfileSnapshot, { recursive: true, force: true })
      stagingConfigDirectory = undefined
    },
  }
}

export function isLegacyBrandMigrationComplete(paths: LegacyBrandMigrationPaths): boolean {
  const marker = readMarker(paths.configDirectory)
  if (marker?.status === 'complete' && marker.sourceConfigDirectory === paths.legacyConfigDirectory) return true
  const profileMarker = readMarker(paths.profileDirectory)
  return !existsSync(paths.legacyConfigDirectory) && profileMarker?.status === 'complete' && profileMarker.sourceConfigDirectory === paths.legacyConfigDirectory
}

export interface LegacyProfileLockAdapter {
  getPath(name: 'userData'): string
  setPath(name: 'userData', path: string): void
  requestSingleInstanceLock(): boolean
  releaseSingleInstanceLock(): void
}

/** 必须在 Electron ready 前同步执行；旧锁覆盖所有旧配置/profile 的快照复制。 */
export function withLegacyProfileLock<T>(adapter: LegacyProfileLockAdapter, profile: string | undefined, copySnapshot: () => T): T {
  if (!profile) return copySnapshot()
  const previous = adapter.getPath('userData')
  let acquired = false
  try {
    adapter.setPath('userData', profile)
    acquired = adapter.requestSingleInstanceLock()
    if (!acquired) throw new Error('Proma 仍在运行。请退出旧应用后重新启动 Gamma；旧数据没有被复制或改写。')
    return copySnapshot()
  } finally {
    if (acquired) adapter.releaseSingleInstanceLock()
    adapter.setPath('userData', previous)
  }
}

function isEncryptedSecret(value: string): boolean {
  const buffer = Buffer.from(value, 'base64')
  return buffer.length > 3 && ['v10', 'v11'].includes(buffer.subarray(0, 3).toString('ascii'))
}

/** 凭据只按已知配置字段枚举，普通 base64 文本和会话正文不参与解密。 */
export function collectLegacyCredentialSlots(directory: string): LegacyCredentialSlot[] {
  const slots: LegacyCredentialSlot[] = []
  const add = (filePath: string, object: unknown, key: string): void => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return
    const record = object as Record<string, unknown>
    const raw = record[key]
    if (typeof raw !== 'string' || !raw) return
    const prefix = raw.startsWith(SECRET_PREFIX) ? SECRET_PREFIX : ''
    const ciphertext = raw.slice(prefix.length)
    if (isEncryptedSecret(ciphertext)) slots.push({ filePath, document: {}, object: record, key, ciphertext, prefix })
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const name = entry.name.replace(/\.(bak|tmp)$/, '')
    if (!['channels.json', 'feishu.json', 'dingtalk.json', 'slack.json', 'wechat.json', 'settings.json', 'mcp-oauth-credentials.json'].includes(name)) continue
    const filePath = join(directory, entry.name)
    let config: Record<string, unknown>
    try { config = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown> } catch { continue }
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue
    if (name === 'channels.json' && Array.isArray(config.channels)) for (const channel of config.channels) add(filePath, channel, 'apiKey')
    if (['feishu.json', 'dingtalk.json'].includes(name)) {
      for (const bot of Array.isArray(config.bots) ? config.bots : [config]) add(filePath, bot, name === 'feishu.json' ? 'appSecret' : 'clientSecret')
    }
    if (name === 'slack.json' && Array.isArray(config.bots)) for (const bot of config.bots) { add(filePath, bot, 'botToken'); add(filePath, bot, 'appToken') }
    if (name === 'wechat.json') add(filePath, config.credentials, 'botToken')
    if (name === 'settings.json') { add(filePath, config.voiceDictation, 'accessToken'); add(filePath, config.voiceDictation, 'accessKey') }
    if (name === 'mcp-oauth-credentials.json' && config.credentials && typeof config.credentials === 'object') for (const key of Object.keys(config.credentials)) add(filePath, config.credentials, key)
    // 保存解析对象供后续一次写完整文件；不写出解密后的明文。
    for (const slot of slots.filter((slot) => slot.filePath === filePath)) slot.document = config
  }
  return slots
}

export function reencryptLegacyCredentialSlots(slots: LegacyCredentialSlot[], plaintexts: readonly string[], encrypt: (value: string) => Buffer): void {
  if (slots.length !== plaintexts.length) throw new Error('旧凭据迁移数量不一致，已停止。')
  const documents = new Map<string, object>()
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!
    slot.object[slot.key] = slot.prefix + encrypt(plaintexts[index]!).toString('base64')
    documents.set(slot.filePath, slot.document)
  }
  for (const [filePath, document] of documents) writeTextFileAtomic(filePath, JSON.stringify(document, null, 2))
}
