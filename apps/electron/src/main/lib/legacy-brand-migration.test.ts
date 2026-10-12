import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { completeBrandMigration } from './complete-brand-migration'
import type { BrandMigrationServices } from './complete-brand-migration'
import { collectLegacyCredentialSlots, getLegacyBrandMigrationPaths, LEGACY_MIGRATION_MARKER, migrateLegacyMetadata, prepareLegacyBrandMigration, withLegacyProfileLock } from './legacy-brand-migration'
import type { LegacyBrandMigrationPaths, PreparedLegacyBrandMigration } from './legacy-brand-migration'

const fixtures: string[] = []
const preparedMigrations: PreparedLegacyBrandMigration[] = []
function fixture(): LegacyBrandMigrationPaths {
  const root = mkdtempSync(join(tmpdir(), 'gamma-brand-test-'))
  fixtures.push(root)
  return getLegacyBrandMigrationPaths({ homeDirectory: root, appDataDirectory: join(root, 'appData'), isDevelopment: false })
}
function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
}
function prepare(paths: LegacyBrandMigrationPaths): PreparedLegacyBrandMigration {
  const value = prepareLegacyBrandMigration(paths)
  preparedMigrations.push(value)
  return value
}
afterEach(() => {
  for (const value of preparedMigrations.splice(0)) value.dispose()
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Gamma 首次启动复制迁移', () => {
  test('Given 全新用户 When 准备迁移 Then 不创建空配置或旧身份数据', () => {
    const paths = fixture()
    const value = prepare(paths)
    expect(value.configNeedsMigration).toBe(false)
    expect(value.profileNeedsMigration).toBe(false)
    value.commit()
    expect(existsSync(paths.configDirectory)).toBe(false)
    expect(existsSync(paths.legacyConfigDirectory)).toBe(false)
  })

  test('Given 旧会话与受管路径 When 发布 Gamma 副本 Then 保留原文与旧文件并更新父会话和工作区路径', () => {
    const paths = fixture()
    const oldSession = join(paths.legacyConfigDirectory, 'agent-sessions', 'a', 'pi.jsonl')
    const data = { piSessionFile: oldSession, parentSession: oldSession, mainRepoRoot: join(paths.legacyConfigDirectory, 'repos', 'a'), content: 'Proma 用户原文', prompt: oldSession, projectRootPath: oldSession, _promaTrace: true, outputMode: 'proma-input' }
    const sessionPath = join(paths.legacyConfigDirectory, 'agent-sessions', 'a', 'session.jsonl')
    write(sessionPath, JSON.stringify(data) + '\n损坏行\n')
    write(join(paths.legacyConfigDirectory, 'agent-workspaces', 'a', 'config.json'), { attachedFiles: [oldSession], attachedDirectories: [dirname(oldSession)] })
    const oldText = readFileSync(sessionPath, 'utf8')
    const value = prepare(paths)
    expect(existsSync(paths.configDirectory)).toBe(false)
    value.commit()
    const text = readFileSync(join(paths.configDirectory, 'agent-sessions', 'a', 'session.jsonl'), 'utf8')
    const next = JSON.parse(text.split('\n')[0]!)
    expect(next.piSessionFile).toBe(oldSession.replace('.proma', '.gamma'))
    expect(next.parentSession).toBe(next.piSessionFile)
    expect(next._gammaTrace).toBe(true)
    expect(next.content).toBe(data.content)
    expect(next.prompt).toBe(oldSession)
    expect(next.projectRootPath).toBe(oldSession)
    expect(next.outputMode).toBe('gamma-input')
    expect(text).toContain('\n损坏行\n')
    const config = JSON.parse(readFileSync(join(paths.configDirectory, 'agent-workspaces', 'a', 'config.json'), 'utf8'))
    expect(config.attachedFiles).toEqual([next.piSessionFile])
    expect(readFileSync(sessionPath, 'utf8')).toBe(oldText)
    expect(JSON.parse(readFileSync(join(paths.configDirectory, LEGACY_MIGRATION_MARKER), 'utf8')).status).toBe('complete')
  })

  test('Given 已完成迁移后留下两个旧 profile When 再启动 Then 不再扫描或合并旧目录', () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'settings.json'), {})
    prepare(paths).commit()
    for (const profile of paths.legacyProfileCandidates) mkdirSync(profile, { recursive: true })
    expect(prepare(paths).configNeedsMigration).toBe(false)
  })

  test('Given 新旧配置同时存在 When 准备迁移 Then 明确停止且不覆盖任一文件', () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'settings.json'), { old: true })
    write(join(paths.configDirectory, 'settings.json'), { new: true })
    expect(() => prepare(paths)).toThrow('同时存在')
    expect(JSON.parse(readFileSync(join(paths.configDirectory, 'settings.json'), 'utf8'))).toEqual({ new: true })
  })

  test('Given 旧浏览器 partition When 迁移中断后重试 Then Gamma 保留 LocalStorage 并清理瞬态锁', () => {
    const paths = fixture()
    const source = paths.legacyProfileCandidates[0]!
    const partition = 'proma-browser-' + 'a'.repeat(32)
    write(join(source, 'Partitions', partition, 'Local Storage', 'value'), '登录偏好')
    write(join(source, 'SingletonLock'), 'old-lock')
    const first = prepare(paths)
    first.dispose()
    const second = prepare(paths)
    expect(second.profileNeedsMigration).toBe(true)
    expect(readFileSync(join(paths.profileDirectory, 'Partitions', partition.replace('proma-', 'gamma-'), 'Local Storage', 'value'), 'utf8')).toBe('登录偏好')
    expect(existsSync(join(paths.profileDirectory, 'SingletonLock'))).toBe(false)
    second.commit()
    expect(existsSync(join(source, 'SingletonLock'))).toBe(true)
  })

  test('Given 配置根或 browser profile 是链接 When 自动迁移 Then 拒绝越界读取或写入', () => {
    const paths = fixture()
    const external = join(dirname(paths.configDirectory), 'external')
    mkdirSync(external)
    symlinkSync(external, paths.legacyConfigDirectory)
    expect(() => prepare(paths)).toThrow('链接')
    rmSync(paths.legacyConfigDirectory)
    write(join(paths.legacyProfileCandidates[0]!, 'Local State'), '{}')
    symlinkSync(external, join(paths.legacyProfileCandidates[0]!, 'Cookies'))
    expect(() => prepare(paths)).toThrow('符号链接')
  })

  test('Given 可预测 .tmp 链接指向外部 When 准备迁移 Then 停止迁移且后续保存不会触及外部', () => {
    const paths = fixture()
    const external = join(dirname(paths.configDirectory), 'outside.txt')
    write(external, '不要改动')
    write(join(paths.legacyConfigDirectory, 'settings.json'), { outputMode: 'proma-input' })
    symlinkSync(external, join(paths.legacyConfigDirectory, 'settings.json.tmp'))
    expect(() => prepare(paths)).toThrow('符号链接')
    expect(existsSync(paths.configDirectory)).toBe(false)
    expect(readFileSync(external, 'utf8')).toBe('不要改动')
  })

  test('Given 内部 Git worktree 使用 canonical 绝对路径 When 改名 Then 两端指针均更新且旧工作树可用', () => {
    const paths = fixture()
    const repository = join(paths.legacyConfigDirectory, 'agent-workspaces', 'a', 'repo')
    const worktree = join(paths.legacyConfigDirectory, 'worktrees', 'b')
    mkdirSync(repository, { recursive: true })
    const git = (args: string[], cwd = repository): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git(['init'])
    write(join(repository, 'file.txt'), 'repo')
    git(['add', 'file.txt'])
    git(['-c', 'user.name=Gamma Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'])
    git(['worktree', 'add', '-b', 'fixture-worktree', worktree])
    prepare(paths).commit()
    const newWorktree = worktree.replace('.proma', '.gamma')
    expect(git(['rev-parse', '--absolute-git-dir'], newWorktree)).toBe(join(realpathSync(repository.replace('.proma', '.gamma')), '.git', 'worktrees', 'b'))
    expect(git(['status', '--porcelain'], worktree)).toBe('')
  })

  test('Given 受管仓库 .git 指向外部链接 When 迁移 Then 停止并保留外部管理目录', () => {
    const paths = fixture()
    const external = join(dirname(paths.configDirectory), 'external-git')
    mkdirSync(external)
    write(join(paths.legacyConfigDirectory, 'repos', 'a', 'file'), 'repo')
    symlinkSync(external, join(paths.legacyConfigDirectory, 'repos', 'a', '.git'))
    expect(() => prepare(paths)).toThrow('符号链接')
    expect(existsSync(paths.configDirectory)).toBe(false)
  })

  test('Given 旧进程仍持有锁 When 获取迁移快照 Then 不执行复制且恢复 Gamma 路径', () => {
    let path = '/gamma'
    let copied = false
    const adapter = { getPath: () => path, setPath: (_name: string, value: string) => { path = value }, requestSingleInstanceLock: () => false, releaseSingleInstanceLock: () => { throw new Error('不应释放别人的锁') } }
    expect(() => withLegacyProfileLock(adapter, '/proma', () => { copied = true })).toThrow('仍在运行')
    expect(copied).toBe(false)
    expect(path).toBe('/gamma')
  })

  test('Given Coach 受管激活与外部自定义 Skill When 更新元数据 Then 仅改受管旧标识', () => {
    const paths = fixture()
    const activation = { slug: 'proma-coach', name: 'proma-coach', filePath: join(paths.legacyConfigDirectory, 'agent-workspaces', 'a', 'skills', 'proma-coach', 'SKILL.md') }
    const external = { slug: 'proma-coach', name: 'proma-coach', filePath: '/user-project/proma-coach/SKILL.md' }
    const result = migrateLegacyMetadata({ skill_activations: [activation, external] }, paths.legacyConfigDirectory, paths.configDirectory) as { skill_activations: typeof activation[] }
    expect(result.skill_activations[0]!.slug).toBe('gamma-coach')
    expect(result.skill_activations[0]!.filePath).toContain('/skills/gamma-coach/')
    expect(result.skill_activations[1]).toEqual(external)
  })
})

describe('旧身份凭据与发布顺序', () => {
  const ciphertext = Buffer.from('v10encrypted-fixture').toString('base64')
  function services(events: string[]): BrandMigrationServices {
    return {
      identities: ['@proma/electron', 'Proma'], encryptionAvailable: () => true,
      encrypt: (value) => { events.push('encrypt'); return Buffer.from('v10Gamma:' + value) },
      startHelper: async (identity) => ({ profileCopy: '/temporary', decrypt: async (values) => values.map(() => identity === 'Proma' ? 'secret-fixture' : null), getCookies: async () => [{ partition: null, cookies: [] }], stop: async () => { events.push('stop:' + identity) } }),
      importCookies: async () => { events.push('cookies') },
    }
  }

  test('Given 各配置已加密字段与普通文本 When 收集迁移凭据 Then 覆盖备份且排除用户文本', () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'channels.json'), { channels: [{ apiKey: ciphertext }, { apiKey: 'plain-secret' }] })
    write(join(paths.legacyConfigDirectory, 'channels.json.bak'), { channels: [{ apiKey: ciphertext }] })
    write(join(paths.legacyConfigDirectory, 'slack.json'), { bots: [{ botToken: 'safeStorage:v1:' + ciphertext, appToken: ciphertext }] })
    write(join(paths.legacyConfigDirectory, 'settings.json'), { voiceDictation: { accessKey: ciphertext, accessToken: ciphertext }, text: ciphertext })
    write(join(paths.legacyConfigDirectory, 'mcp-oauth-credentials.json'), { credentials: { server: 'safeStorage:v1:' + ciphertext } })
    expect(collectLegacyCredentialSlots(paths.legacyConfigDirectory)).toHaveLength(7)
  })

  test('Given 第一个旧身份解密失败 When 第二个成功 Then 仅将重新加密的配置发布到 Gamma', async () => {
    const paths = fixture()
    const source = join(paths.legacyConfigDirectory, 'channels.json')
    write(source, { channels: [{ apiKey: ciphertext }] })
    const events: string[] = []
    await completeBrandMigration(prepare(paths), services(events))
    const text = readFileSync(join(paths.configDirectory, 'channels.json'), 'utf8')
    expect(text).not.toContain('secret-fixture')
    expect(Buffer.from(JSON.parse(text).channels[0].apiKey, 'base64').toString()).toBe('v10Gamma:secret-fixture')
    expect(JSON.parse(readFileSync(source, 'utf8')).channels[0].apiKey).toBe(ciphertext)
    expect(events).toEqual(['stop:@proma/electron', 'encrypt', 'stop:Proma'])
  })

  test('Given 系统加密不可用 When 完成迁移 Then 不启动 helper、不发布配置且保留旧加密数据', async () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'channels.json'), { channels: [{ apiKey: ciphertext }] })
    const events: string[] = []
    await expect(completeBrandMigration(prepare(paths), { ...services(events), encryptionAvailable: () => false })).rejects.toThrow('暂不可用')
    expect(existsSync(paths.configDirectory)).toBe(false)
    expect(events).toEqual([])
  })

  test('Given Cookie 迁移失败 When 完成迁移 Then 不发布配置并释放 helper，重试保留副本', async () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'settings.json'), {})
    write(join(paths.legacyProfileCandidates[0]!, 'Local State'), '{}')
    const events: string[] = []
    await expect(completeBrandMigration(prepare(paths), { ...services(events), importCookies: async () => { throw new Error('cookie fixture failure') } })).rejects.toThrow('cookie fixture')
    expect(existsSync(paths.configDirectory)).toBe(false)
    expect(events).toEqual(['stop:@proma/electron'])
    expect(prepare(paths).profileNeedsMigration).toBe(true)
  })

  test('Given 无应用密文但有旧登录 Cookie When 首身份静默丢行 Then 尝试下一身份再发布配置', async () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'settings.json'), {})
    write(join(paths.legacyProfileCandidates[0]!, 'Local State'), '{}')
    const events: string[] = []
    const inventory = { profiles: [{ partition: null, cookies: [{ domain: '.example.test', name: 'login', path: '/', encrypted: true, hasPlaintextValue: false }] }] }
    await completeBrandMigration(prepare(paths), {
      ...services(events),
      readCookieInventory: () => inventory,
      startHelper: async (identity) => ({
        profileCopy: '/temporary', decrypt: async () => [],
        getCookies: async () => [{ partition: null, cookies: identity === 'Proma' ? [{ domain: '.example.test', name: 'login', path: '/', value: 'fixture-login', sameSite: 'lax' }] : [] }],
        stop: async () => { events.push('stop:' + identity) },
      }),
    })
    expect(events).toEqual(['stop:@proma/electron', 'cookies', 'stop:Proma'])
    expect(existsSync(join(paths.configDirectory, LEGACY_MIGRATION_MARKER))).toBe(true)
  })

  test('Given 所有旧身份均丢失 Cookie When 候选校验失败 Then 不发布配置且下次可重试', async () => {
    const paths = fixture()
    write(join(paths.legacyConfigDirectory, 'settings.json'), {})
    write(join(paths.legacyProfileCandidates[0]!, 'Local State'), '{}')
    const events: string[] = []
    await expect(completeBrandMigration(prepare(paths), {
      ...services(events),
      readCookieInventory: () => ({ profiles: [{ partition: null, cookies: [{ domain: '.example.test', name: 'login', path: '/', encrypted: true, hasPlaintextValue: false }] }] }),
    })).rejects.toThrow('未完整解密')
    expect(events).toEqual(['stop:@proma/electron', 'stop:Proma'])
    expect(existsSync(paths.configDirectory)).toBe(false)
    expect(prepare(paths).profileNeedsMigration).toBe(true)
  })
})
