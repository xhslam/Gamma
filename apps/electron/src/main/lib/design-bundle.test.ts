import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DESIGN_BUNDLE_REVISION, DESIGN_SOURCE_REVISION } from '@gamma/shared'
import { createDesignBundleService } from './design-bundle'
import { prepareDesignBundle } from '../../../scripts/prepare-design-bundle'
import type { DesignBundleDependencies, DesignCommandResult, DesignExecutionOptions } from './design-bundle'

const skills = ['claude-slides', 'claude-design', 'claude-design-system', 'claude-dashboard', 'claude-motion', 'claude-whiteboard', 'dataviz', 'motion-director']
const probeOutput = { stdout: '{"nodeVersion":"24.18.0","supportsSqlite":true}\n', stderr: '' }
let directory: string
let source: string
let root: string
async function fixture(): Promise<void> {
  source = join(directory, 'source')
  for (const name of skills) {
    const skill = join(source, 'skills', name)
    await mkdir(join(skill, 'scripts', 'editor'), { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), `---\nname: ${name}\n---\n`)
    if (name.startsWith('claude-')) {
      await writeFile(join(skill, 'scripts', 'artifact.mjs'), 'console.log(JSON.stringify({args:process.argv.slice(2),node:process.versions.node,key:!!process.env.GAMMA_DESIGN_TEST_SECRET,options:!!process.env.NODE_OPTIONS}));')
      await writeFile(join(skill, 'scripts', 'editor', 'index.html'), '<html></html>')
      await writeFile(join(skill, 'scripts', 'editor', 'third-party-licenses.txt'), 'original licenses')
    }
  }
  await mkdir(join(source, 'dsh-plugins', 'dsh-claude-artifacts', 'lib'), { recursive: true })
  for (const name of ['index.js', 'client.js']) await writeFile(join(source, 'dsh-plugins', 'dsh-claude-artifacts', 'lib', name), '// upstream')
  await writeFile(join(source, 'LICENSE'), 'original license')
  await writeFile(join(source, 'NOTICE.md'), 'original mixed license notice')
}
function service(overrides: DesignBundleDependencies = {}) {
  return createDesignBundleService({ installRoot: root, runtimePath: '/mock/node', execute: async () => probeOutput, fetchSource: async () => source, ...overrides })
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gamma-design-bundle-test-'))
  root = join(directory, 'cache')
  await fixture()
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('内置 design 运行包', () => {
  test('Given 全新构建目录 When 准备资源两次 Then 仅构建期获取一次且可离线直接使用', async () => {
    let fetched = 0
    const app = join(directory, 'app')
    const dependencies = { runtimePath: '/mock/node', execute: async () => probeOutput, fetchSource: async () => { fetched++; return source } }
    const first = await prepareDesignBundle(app, dependencies)
    const second = await prepareDesignBundle(app, dependencies)
    expect(fetched).toBe(1)
    expect(first.bundlePath).toBe(join(app, 'resources/design-bundle', DESIGN_BUNDLE_REVISION))
    expect(second).toEqual(first)
    const offline = service({ bundledRoot: first.bundlePath, fetchSource: async () => { throw new Error('不应联网') } })
    expect((await offline.getDesignBundleStatus()).installed).toBe(true)
    expect(await readFile(join(first.bundlePath!, 'NOTICE.md'), 'utf8')).toBe('original mixed license notice')
  })
  test('Given 应用内置固定完整包且没有用户缓存 When 离线读取和执行 Then 无需安装或网络', async () => {
    await writeFile(join(source, '.gamma-design-revision'), DESIGN_BUNDLE_REVISION)
    const calls: string[][] = []
    const bundle = service({ bundledRoot: source, fetchSource: async () => { throw new Error('不应联网') }, execute: async (_path, args) => {
      if (args[0] === '--input-type=module') return probeOutput
      calls.push(args)
      return { stdout: '{}', stderr: '' }
    } })
    expect(await bundle.getDesignBundleStatus()).toMatchObject({ installed: true, bundlePath: source })
    expect(await bundle.getDesignBundleSkillPath('whiteboard')).toBe(join(source, 'skills/claude-whiteboard'))
    await bundle.runDesignArtifactCommand('canvas', ['help'])
    expect(calls[0]?.[0]).toBe(join(source, 'skills/claude-design/scripts/artifact.mjs'))
    await expect(lstat(root)).rejects.toThrow()
  })
  test('Given 内置包缺少编辑器文件 When 检查 Then 不误报可用也不自动下载', async () => {
    await writeFile(join(source, '.gamma-design-revision'), DESIGN_BUNDLE_REVISION)
    await rm(join(source, 'skills/claude-whiteboard/scripts/editor/index.html'))
    const bundle = service({ bundledRoot: source, fetchSource: async () => { throw new Error('不应联网') } })
    expect((await bundle.getDesignBundleStatus()).installed).toBe(false)
    await expect(bundle.getDesignBundleSkillPath('whiteboard')).rejects.toThrow()
    await expect(lstat(root)).rejects.toThrow()
  })
})

describe('完整 design 运行包安装', () => {
  test('Given 未确认第三方许可 When 安装 Then 不下载、不探测、不创建缓存', async () => {
    let touched = false
    const bundle = service({ execute: async () => { touched = true; return probeOutput }, fetchSource: async () => { touched = true; return source } })
    await expect(bundle.installDesignBundle(false)).rejects.toThrow('第三方')
    expect(touched).toBe(false)
    await expect(lstat(root)).rejects.toThrow()
  })
  test('Given 完整源码 When 安装 Then 原子发布八技能六编辑器与原始许可，并保持用户同名 Skill 不变', async () => {
    const userSkill = join(directory, 'workspace', 'skills', 'claude-design')
    await mkdir(userSkill, { recursive: true })
    await writeFile(join(userSkill, 'SKILL.md'), 'user content')
    const bundle = service()
    expect((await bundle.getDesignBundleStatus()).installed).toBe(false)
    const status = await bundle.installDesignBundle(true)
    expect(status).toMatchObject({ installed: true, revision: DESIGN_BUNDLE_REVISION, nodeVersion: '24.18.0', supportsSqlite: true })
    expect((await readdir(join(status.bundlePath!, 'skills'))).sort()).toEqual([...skills].sort())
    expect(await readFile(join(status.bundlePath!, 'NOTICE.md'), 'utf8')).toBe('original mixed license notice')
    expect(await readFile(join(userSkill, 'SKILL.md'), 'utf8')).toBe('user content')
    expect(await readdir(root)).toEqual([DESIGN_BUNDLE_REVISION])
    for (const [kind, name] of [['canvas', 'claude-design'], ['slides', 'claude-slides'], ['system', 'claude-design-system'], ['dashboard', 'claude-dashboard'], ['motion', 'claude-motion'], ['whiteboard', 'claude-whiteboard']] as const) {
      expect(await bundle.getDesignBundleSkillPath(kind)).toBe(join(status.bundlePath!, 'skills', name))
    }
  })
  test('Given 旧五编辑器缓存已存在 When 安装含白板的组合包 Then 不覆盖或删除旧缓存', async () => {
    const previous = join(root, DESIGN_SOURCE_REVISION)
    await mkdir(previous, { recursive: true })
    await writeFile(join(previous, 'keep'), '旧运行包')
    const status = await service().installDesignBundle(true)
    expect(status.bundlePath).toBe(join(root, DESIGN_BUNDLE_REVISION))
    expect(await readFile(join(previous, 'keep'), 'utf8')).toBe('旧运行包')
  })
  test('Given 缺少白板编辑器 When 安装 Then 不发布半个组合运行包', async () => {
    await rm(join(source, 'skills', 'claude-whiteboard', 'scripts', 'editor', 'index.html'))
    await expect(service().installDesignBundle(true)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })
  test('Given 相同服务的并发请求 When 安装 Then 只下载一次并且拒绝未确认加入', async () => {
    let fetched = 0
    const bundle = service({ fetchSource: async () => { fetched++; return source } })
    const requests = [bundle.installDesignBundle(true), bundle.installDesignBundle(true)]
    await expect(bundle.installDesignBundle(false)).rejects.toThrow('第三方')
    const statuses = await Promise.all(requests)
    expect(fetched).toBe(1)
    expect(statuses[0]).toEqual(statuses[1])
    await bundle.installDesignBundle(true)
    expect(fetched).toBe(1)
  })
  test('Given 其他进程持有安装锁 When 安装 Then 拒绝而不清除别人的锁', async () => {
    await mkdir(join(root, `.${DESIGN_BUNDLE_REVISION}.lock`), { recursive: true })
    await expect(service().installDesignBundle(true)).rejects.toThrow('安装锁')
    expect((await lstat(join(root, `.${DESIGN_BUNDLE_REVISION}.lock`))).isDirectory()).toBe(true)
  })
  test('Given 源码存在 symlink When 安装 Then 拒绝并清理暂存和锁', async () => {
    await symlink(join(directory, 'outside'), join(source, 'skills', 'claude-design', 'evil'))
    await expect(service().installDesignBundle(true)).rejects.toThrow('符号链接')
    expect(await readdir(root)).toEqual([])
  })
  test('Given 源码父目录是 symlink When 安装 Then 拒绝跨越父目录链接', async () => {
    const real = join(directory, 'real-skills')
    const { rename } = await import('node:fs/promises')
    await rename(join(source, 'skills'), real)
    await symlink(real, join(source, 'skills'))
    await expect(service().installDesignBundle(true)).rejects.toThrow('符号链接')
    expect(await readdir(root)).toEqual([])
  })
  test('Given 超大文件 When 安装 Then 复制前拒绝', async () => {
    const large = join(source, 'skills', 'dataviz', 'large')
    await writeFile(large, '')
    await truncate(large, 65 * 1024 * 1024)
    await expect(service().installDesignBundle(true)).rejects.toThrow('大小限制')
    expect(await readdir(root)).toEqual([])
  })
  test('Given 缺少八技能之一 When 安装 Then 失败清理且不会发布部分运行包', async () => {
    await rm(join(source, 'skills', 'motion-director'), { recursive: true })
    await expect(service().installDesignBundle(true)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })
  test('Given 同 revision 缓存损坏 When 安装 Then 不覆盖原内容', async () => {
    await mkdir(join(root, DESIGN_BUNDLE_REVISION), { recursive: true })
    await writeFile(join(root, DESIGN_BUNDLE_REVISION, 'keep'), 'keep')
    const bundle = service()
    expect((await bundle.getDesignBundleStatus()).installed).toBe(false)
    await expect(bundle.installDesignBundle(true)).rejects.toThrow('不会覆盖')
    expect(await readFile(join(root, DESIGN_BUNDLE_REVISION, 'keep'), 'utf8')).toBe('keep')
  })
  test('Given 下载失败 When 安装 Then 释放锁与暂存，允许下一次重试', async () => {
    let first = true
    const bundle = service({ fetchSource: async () => { if (first) { first = false; throw new Error('offline') }; return source } })
    await expect(bundle.installDesignBundle(true)).rejects.toThrow('offline')
    expect(await readdir(root)).toEqual([])
    expect((await bundle.installDesignBundle(true)).installed).toBe(true)
  })
  test('Given 无 SQLite 或版本过旧 When 安装 Then 说明环境不足且不下载', async () => {
    for (const value of [{ nodeVersion: '20.0.0', supportsSqlite: true }, { nodeVersion: '22.0.0', supportsSqlite: false }]) {
      const bundle = service({ execute: async () => ({ stdout: JSON.stringify(value), stderr: '' }), fetchSource: async () => { throw new Error('不应下载') } })
      expect((await bundle.getDesignBundleStatus()).supportsSqlite).toBe(false)
      await expect(bundle.installDesignBundle(true)).rejects.toThrow('Node 22+')
    }
  })
})

describe('固定 Node 的无 shell 命令桥', () => {
  test('Given 未授权命令或网络/执行参数 When 调用 Then 不执行任何进程', async () => {
    let runs = 0
    const bundle = service({ execute: async () => { runs++; return probeOutput } })
    for (const args of [['share', '/tmp/artifact'], ['serve', '/tmp/artifact'], ['voice', '/tmp/artifact'], ['open', '/tmp/artifact', '--lan'], ['open', '/tmp/artifact', '--agent-hook', 'echo secret'], ['open', '/tmp/artifact', '--host', '0.0.0.0'], ['open', '/tmp/artifact', '--host=0.0.0.0'], ['check', 'relative'], ['list']]) {
      await expect(bundle.runDesignArtifactCommand('canvas', args)).rejects.toThrow()
    }
    expect(runs).toBe(0)
  })
  test('Given 已安装包 When 执行评论/数据库命令 Then 固定脚本、完整 argv、超时取消，且不继承凭据', async () => {
    const calls: { path: string; args: string[]; options: DesignExecutionOptions }[] = []
    const bundle = service({ execute: async (path, args, options): Promise<DesignCommandResult> => {
      if (args[0] === '--input-type=module') return probeOutput
      calls.push({ path, args, options })
      return { stdout: 'result', stderr: '' }
    } })
    await bundle.installDesignBundle(true)
    const secret = process.env.GAMMA_DESIGN_TEST_SECRET
    process.env.GAMMA_DESIGN_TEST_SECRET = 'not-a-real-secret'
    try {
      const controller = new AbortController()
      const result = await bundle.runDesignArtifactCommand('canvas', ['comment-reply', '/tmp/artifact', 'comment-id', 'hello world; $(whoami)', '--resolve'], { timeoutMs: 1234, signal: controller.signal })
      expect(result.stdout).toBe('result')
      expect(calls[0]!.path).toBe('/mock/node')
      expect(calls[0]!.args.slice(1)).toEqual(['comment-reply', '/tmp/artifact', 'comment-id', 'hello world; $(whoami)', '--resolve'])
      expect(calls[0]!.options.timeout).toBe(1234)
      expect(calls[0]!.options.cwd).toBe('/tmp/artifact')
      expect(calls[0]!.options.signal).toBe(controller.signal)
      expect(calls[0]!.options.env.GAMMA_DESIGN_TEST_SECRET).toBeUndefined()
      expect(calls[0]!.options.env.NODE_OPTIONS).toBeUndefined()
      expect(calls[0]!.options.env.ELECTRON_RUN_AS_NODE).toBe('1')
      await bundle.runDesignArtifactCommand('dashboard', ['write-db', '/tmp/artifact', '/tmp/batch.json'])
      await expect(bundle.runDesignArtifactCommand('canvas', ['write-db', '/tmp/artifact', '/tmp/batch.json'])).rejects.toThrow('不允许')
      controller.abort()
      await expect(bundle.runDesignArtifactCommand('canvas', ['check', '/tmp/artifact'], { signal: controller.signal })).rejects.toThrow('取消')
      expect(calls).toHaveLength(2)
    } finally {
      if (secret === undefined) delete process.env.GAMMA_DESIGN_TEST_SECRET
      else process.env.GAMMA_DESIGN_TEST_SECRET = secret
    }
  })
  test('Given 白板已安装 When 读写和读取用户视图 Then 使用白板脚本且不允许网络分享', async () => {
    const calls: string[][] = []
    const bundle = service({ execute: async (_path, args) => {
      if (args[0] === '--input-type=module') return probeOutput
      calls.push(args)
      return { stdout: '{}', stderr: '' }
    } })
    await bundle.installDesignBundle(true)
    for (const args of [['write-db', '/tmp/board', '/tmp/batch.json'], ['read-db', '/tmp/board', 'elements'], ['context', '/tmp/board']]) {
      await bundle.runDesignArtifactCommand('whiteboard', args)
    }
    expect(calls).toHaveLength(3)
    expect(calls.every((args) => args[0]!.includes('claude-whiteboard/scripts/artifact.mjs'))).toBe(true)
    for (const args of [['share', '/tmp/board'], ['open', '/tmp/board', '--lan']]) {
      await expect(bundle.runDesignArtifactCommand('whiteboard', args)).rejects.toThrow('不允许')
    }
    expect(calls).toHaveLength(3)
  })
  test('Given 实际 Electron 内置 Node When 探测 SQLite 并执行脚本 Then 不以 Bun 替代且可加载 node:sqlite', async () => {
    // 全局 test-preload mock 了 electron 导出；从已安装包读实际可执行路径，不移除全局 mock。
    const electronRoot = dirname(require.resolve('electron/package.json'))
    const executable = join(electronRoot, 'dist', (await readFile(join(electronRoot, 'path.txt'), 'utf8')).trim())
    const bundle = createDesignBundleService({ installRoot: root, runtimePath: executable, fetchSource: async () => source })
    const status = await bundle.getDesignBundleStatus()
    expect(status.supportsSqlite).toBe(true)
    expect(Number(status.nodeVersion.split('.')[0])).toBeGreaterThanOrEqual(22)
    await bundle.installDesignBundle(true)
    const artifact = join(directory, 'artifact')
    await mkdir(artifact)
    const result = await bundle.runDesignArtifactCommand('dashboard', ['check', artifact])
    expect(JSON.parse(result.stdout)).toMatchObject({ args: ['check', artifact], node: status.nodeVersion, key: false, options: false })
  })
})
