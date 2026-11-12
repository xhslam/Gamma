import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesignArtifact } from '@gamma/shared'
import { createDesignDeliveryService, saveDesignArchive } from './design-delivery'
import { flushDesignEditor } from './design-editor-flush'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'gamma-design-delivery-'))
  temporary.push(base)
  const root = join(base, 'artifact')
  const workbench = join(base, 'session')
  await mkdir(join(root, 'project/assets'), { recursive: true })
  await mkdir(workbench)
  await writeFile(join(root, 'project/canvas.json'), '{"order":["one.dc.html","two.dc.html"]}')
  await writeFile(join(root, 'project/one.dc.html'), '<h1>one</h1>')
  await writeFile(join(root, 'project/two.dc.html'), '<h1>two</h1>')
  await writeFile(join(root, 'project/assets/icon.svg'), '<svg/>')
  await writeFile(join(root, '.artifact-server.json'), '{"pid":123}')
  await mkdir(join(root, 'exports'))
  await writeFile(join(root, 'exports/old.zip'), 'old export')
  const artifact: DesignArtifact = { id: 'design-id', workspaceId: 'workspace', sessionId: 'session', kind: 'canvas', rootPath: root, title: '完整界面', createdAt: 1, updatedAt: 1 }
  const events: string[] = []
  let failArchive = false
  let failFlush = false
  const service = createDesignDeliveryService({
    getArtifact: async (workspace, id) => { if (workspace !== artifact.workspaceId || id !== artifact.id) throw new Error('作品不存在'); events.push('validate'); return artifact },
    getWorkbench: async () => workbench,
    getSkillPath: async () => '/bundle/claude-design',
    flush: async () => { events.push('flush'); if (failFlush) throw new Error('未保存'); await writeFile(join(root, 'project/two.dc.html'), '<h1>saved</h1>') },
    archive: async (_artifact, snapshot, output) => { events.push('archive'); if (failArchive) throw new Error('打包失败'); await writeFile(output, `ZIP:${await readFile(join(snapshot, 'project/two.dc.html'), 'utf8')}`) },
  })
  return { base, root, workbench, artifact, service, events, failArchive: () => { failArchive = true }, failFlush: () => { failFlush = true } }
}

describe('Given 已登记设计作品的完整稿交付', () => {
  test('When 添加到对话 Then 等待保存、重新校验并快照全部页面与素材，排除临时状态和旧导出', async () => {
    const f = await fixture()
    const result = await f.service.prepare('workspace', 'design-id')
    expect(f.events).toEqual(['validate', 'flush', 'validate', 'archive'])
    expect(result.fileCount).toBe(4)
    expect(await readFile(join(result.snapshotPath, 'project/two.dc.html'), 'utf8')).toContain('saved')
    expect(await readFile(join(result.snapshotPath, 'project/assets/icon.svg'), 'utf8')).toBe('<svg/>')
    expect(await readdir(result.snapshotPath)).toEqual(['project'])
    expect(result.prompt).toContain('应用代码实施需求')
    expect(result.prompt).toContain(result.snapshotPath)
    await writeFile(join(f.root, 'project/one.dc.html'), 'later edits')
    expect(await readFile(join(result.snapshotPath, 'project/one.dc.html'), 'utf8')).toContain('<h1>one</h1>')
    expect(result.archiveBytes).toBeGreaterThan(0)
  })
  test('When 跨项目或伪造作品 Then 不生成任何交付目录', async () => {
    const f = await fixture()
    await expect(f.service.prepare('other', 'design-id')).rejects.toThrow('作品不存在')
    expect(await readdir(f.workbench)).toEqual([])
  })
  test('When 保存尚未完成 Then 不导出旧稿', async () => {
    const f = await fixture(); f.failFlush()
    await expect(f.service.prepare('workspace', 'design-id')).rejects.toThrow('未保存')
    expect(f.events).not.toContain('archive')
    expect(await readdir(f.workbench)).toEqual([])
  })
  test('When 作品内部包含符号链接 Then 拒绝快照且清理未完成目录', async () => {
    const f = await fixture()
    await symlink(join(f.base, 'secret'), join(f.root, 'project/link'))
    await expect(f.service.prepare('workspace', 'design-id')).rejects.toThrow('链接')
    expect(await readdir(join(f.workbench, 'design-handoffs'))).toEqual([])
  })
  test('When 会话交付目录被替换为链接 Then 不向链接目标写入文件', async () => {
    const f = await fixture()
    const outside = join(f.base, 'outside'); await mkdir(outside)
    await symlink(outside, join(f.workbench, 'design-handoffs'))
    await expect(f.service.prepare('workspace', 'design-id')).rejects.toThrow('目录不可用')
    expect(await readdir(outside)).toEqual([])
  })
  test('When 归档失败 Then 删除不完整的交接快照，不报告成功', async () => {
    const f = await fixture(); f.failArchive()
    await expect(f.service.prepare('workspace', 'design-id')).rejects.toThrow('打包失败')
    expect(await readdir(join(f.workbench, 'design-handoffs'))).toEqual([])
  })
  test('When 保存成稿到指定路径 Then 输出完整归档，来源失败时保留已有文件', async () => {
    const f = await fixture()
    const result = await f.service.prepare('workspace', 'design-id')
    const target = join(f.base, 'export.zip')
    await saveDesignArchive(result.archivePath, target)
    const bytes = await readFile(target)
    expect(bytes).toEqual(await readFile(result.archivePath))
    await expect(saveDesignArchive(join(f.base, 'missing'), target)).rejects.toThrow()
    expect(await readFile(target)).toEqual(bytes)
  })
})

describe('Given 保存屏障只适用于对应 Design 顶层页面', () => {
  test('When 保存成功 Then 允许后续快照；未保存或导航变化时拒绝', async () => {
    let url = 'http://127.0.0.1:4000/design/token/'
    const expected = url
    let saved = true
    const contents = { getURL: () => url, isDestroyed: () => false, executeJavaScript: async () => saved }
    await flushDesignEditor(contents, expected)
    saved = false
    await expect(flushDesignEditor(contents, expected)).rejects.toThrow('尚未保存')
    url = expected + '?at=123'
    saved = true
    await expect(flushDesignEditor(contents, expected)).rejects.toThrow('当前版本')
    url = 'https://example.com/'
    await expect(flushDesignEditor(contents, expected)).rejects.toThrow('对应的设计编辑器')
  })
})

test('Given 六类真实原版归档命令 When 交付完整稿 Then ZIP 可解读且包含原始元数据与所有素材', async () => {
  const { DESIGN_BUNDLE_REVISION } = await import('@gamma/shared')
  const { createDesignArtifactService } = await import('./design-artifacts')
  const { getElectronExecutablePath } = await import('../../test-utils/electron-executable')
  const { resolve } = await import('node:path')
  const { inflateRawSync } = await import('node:zlib')
  const base = await mkdtemp(join(tmpdir(), 'gamma-real-design-archive-'))
  temporary.push(base)
  const project = join(base, 'project'); const storage = join(base, 'storage'); const workbench = join(base, 'session')
  await Promise.all([mkdir(project), mkdir(storage), mkdir(workbench)])
  const service = createDesignArtifactService({
    getWorkspace: () => ({ id: 'workspace', slug: 'workspace', projectRootPath: project }), getSession: () => ({ workspaceId: 'workspace' }),
    getWorkspacePath: () => storage, getSkillPath: () => '/bundle', run: async () => { throw new Error('不应启动编辑器') }, probe: async () => true,
  })
  const metadata = { canvas: 'project/canvas.json', slides: 'project/deck.json', system: 'project/design-system.json', dashboard: 'db/dash/meta.json', motion: 'db/film/meta.json', whiteboard: 'db/board/meta.json' } as const
  for (const kind of Object.keys(metadata) as Array<keyof typeof metadata>) {
    const artifact = await service.createDesignArtifact({ workspaceId: 'workspace', sessionId: 'session', kind, title: `完整 ${kind}` })
    await mkdir(join(artifact.rootPath, 'assets/exports'), { recursive: true })
    await writeFile(join(artifact.rootPath, 'assets/exports/logo.svg'), '<svg>nested</svg>')
    if (['dashboard', 'motion', 'whiteboard'].includes(kind)) {
      await mkdir(join(artifact.rootPath, 'db/exports'), { recursive: true })
      await writeFile(join(artifact.rootPath, 'db/exports/item.json'), '{"name":"legitimate collection"}')
    }
    const asset = Buffer.from([0, 1, 2, 127, 255]); await writeFile(join(artifact.rootPath, 'assets/all.bin'), asset)
    const skill = resolve(import.meta.dir, '../../../resources/design-bundle', DESIGN_BUNDLE_REVISION, 'skills', { canvas: 'claude-design', slides: 'claude-slides', system: 'claude-design-system', dashboard: 'claude-dashboard', motion: 'claude-motion', whiteboard: 'claude-whiteboard' }[kind])
    const delivery = createDesignDeliveryService({
      getArtifact: service.getDesignArtifact, getWorkbench: async () => workbench, getSkillPath: async () => skill, flush: async () => {},
      archive: async (_artifact, root, output) => {
        const child = Bun.spawn([getElectronExecutablePath(), join(skill, 'scripts/artifact.mjs'), 'archive', root, '--out', output], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdout: 'pipe', stderr: 'pipe' })
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
        if (code !== 0) throw new Error(`真实归档失败: ${stderr}\n${stdout}`)
      },
    })
    const result = await delivery.prepare('workspace', artifact.id)
    const zip = await readFile(result.archivePath)
    // 从中央目录读取条目，验证压缩后的真实文件字节，不只看 ZIP 文件是否存在。
    const entries = new Map<string, Buffer>()
    const end = zip.length - 22
    expect(zip.readUInt32LE(end)).toBe(0x06054b50)
    let offset = zip.readUInt32LE(end + 16)
    for (let index = 0; index < zip.readUInt16LE(end + 10); index++) {
      expect(zip.readUInt32LE(offset)).toBe(0x02014b50)
      const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20), nameLength = zip.readUInt16LE(offset + 28)
      const extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32), local = zip.readUInt32LE(offset + 42)
      const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString()
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const compressed = zip.subarray(start, start + size)
      entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed)
      offset += 46 + nameLength + extraLength + commentLength
    }
    expect(entries.get(`${artifact.id}/assets/all.bin`)).toEqual(asset)
    expect(entries.get(`${artifact.id}/assets/exports/logo.svg`)?.toString()).toBe('<svg>nested</svg>')
    if (['dashboard', 'motion', 'whiteboard'].includes(kind)) expect(entries.get(`${artifact.id}/db/exports/item.json`)?.toString()).toContain('legitimate collection')
    expect(JSON.parse(entries.get(`${artifact.id}/${metadata[kind]}`)!.toString())).toBeObject()
    expect([...entries.keys()].some(name => name.includes('.artifact-server') || name.includes('.sharing.json'))).toBe(false)
  }
}, 60_000)
