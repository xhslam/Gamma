import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesignArtifactKind } from '../../../../../packages/shared/src/types/design-workbench'
import { createDesignArtifactService } from './design-artifacts'

const temp: string[] = []
afterEach(() => { for (const path of temp.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture(external = true) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gamma-artifacts-')))
  temp.push(base)
  const storage = join(base, 'workspace')
  const project = join(base, 'project')
  mkdirSync(storage); mkdirSync(project)
  const calls: string[][] = []
  let installed = true
  let sessionWorkspace = 'w1'
  let returnedUrl = 'http://127.0.0.1:49152/'
  let reused = false
  let ready = true
  const deps = {
    getWorkspace: (id: string) => id === 'w1' ? { id, slug: 'one', projectRootPath: external ? project : undefined } : undefined,
    getSession: () => ({ workspaceId: sessionWorkspace }),
    getWorkspacePath: () => storage,
    getSkillPath: () => { if (!installed) throw new Error('完整 design 运行包尚未安装'); return '/installed/skill' },
    run: async (_type: DesignArtifactKind, args: string[]) => {
      calls.push(args)
      if (args[0] === 'stop') return { stdout: JSON.stringify({ stopped: true }) }
      const state = { root: args[1], url: returnedUrl, pid: 12345 }
      writeFileSync(join(args[1]!, '.artifact-server.json'), JSON.stringify(state))
      return { stdout: JSON.stringify({ ...state, reused }) }
    },
    probe: async () => ready,
  }
  const service = createDesignArtifactService(deps)
  const create = (kind: DesignArtifactKind = 'canvas') => service.createDesignArtifact({ workspaceId: 'w1', sessionId: 's1', title: '测试 <作品>', kind })
  return { base, storage, project, calls, deps, service, create,
    installed: (value: boolean) => { installed = value }, sessionWorkspace: (value: string) => { sessionWorkspace = value },
    returnedUrl: (value: string) => { returnedUrl = value }, reused: (value: boolean) => { reused = value }, ready: (value: boolean) => { ready = value } }
}
const files: Record<DesignArtifactKind, string> = {
  slides: 'project/deck.json', canvas: 'project/canvas.json', system: 'project/design-system.json',
  dashboard: 'db/files/index.html.json', motion: 'db/film/script.json',
}

describe('Given 经授权的 Gamma 项目与作品会话', () => {
  for (const type of Object.keys(files) as DesignArtifactKind[]) {
    test(`When 新建 ${type} Then 写入原生可打开作品而非空目录`, async () => {
      const f = fixture()
      const artifact = await f.create(type)
      expect(artifact.rootPath).toBe(join(f.project, 'designs', artifact.id))
      expect(JSON.parse(readFileSync(join(artifact.rootPath, files[type]), 'utf8'))).toBeObject()
      expect((await f.service.listDesignArtifacts('w1')).map((item) => item.id)).toEqual([artifact.id])
      if (type === 'canvas') expect(readFileSync(join(artifact.rootPath, 'project/Main.dc.html'), 'utf8')).toContain('&lt;作品&gt;')
      if (type === 'motion') expect(JSON.parse(readFileSync(join(artifact.rootPath, 'db/modules/scene-intro.js.json'), 'utf8')).text).toContain('init(kit)')
    })
  }
  test('When 没有外部项目 Then 仅写 workspace-files/designs', async () => {
    const f = fixture(false)
    const artifact = await f.create()
    expect(artifact.rootPath).toBe(join(f.storage, 'workspace-files/designs', artifact.id))
  })
  test('When 外部项目根不可用 Then 失败且不偷偷切换托管目录', async () => {
    const f = fixture()
    rmSync(f.project, { recursive: true })
    await expect(f.create()).rejects.toThrow('根目录不可用')
  })
  test('When 未安装、错误 kind、跨项目会话或无效标题 Then 拒绝创建', async () => {
    const f = fixture()
    f.installed(false)
    await expect(f.create()).rejects.toThrow('尚未安装')
    f.installed(true); f.sessionWorkspace('w2')
    await expect(f.create()).rejects.toThrow('不属于')
    await expect(f.service.createDesignArtifact({ workspaceId: 'w1', sessionId: 's1', title: '测试', kind: 'oops' as DesignArtifactKind })).rejects.toThrow('作品类型')
    await expect(f.service.createDesignArtifact({ workspaceId: 'w1', sessionId: 's1', title: '', kind: 'canvas' })).rejects.toThrow('标题')
    await expect(f.service.listDesignArtifacts('unknown')).rejects.toThrow('项目不存在')
  })
  test('When 并发创建 Then 索引不丢失记录', async () => {
    const f = fixture()
    const items = await Promise.all(Array.from({ length: 12 }, () => f.create()))
    expect(new Set(items.map((item) => item.id)).size).toBe(12)
    expect(await f.service.listDesignArtifacts('w1')).toHaveLength(12)
  })
  for (const target of ['designs', 'artifact', 'nested', 'index']) {
    test(`When ${target} 含符号链接 Then 不读取或写入链接目标`, async () => {
      const f = fixture()
      if (target === 'designs') {
        symlinkSync(f.base, join(f.project, 'designs'))
        await expect(f.create()).rejects.toThrow('符号链接')
      } else if (target === 'index') {
        writeFileSync(join(f.base, 'outside.json'), '{}')
        symlinkSync(join(f.base, 'outside.json'), join(f.storage, 'design-artifacts.json'))
        await expect(f.create()).rejects.toThrow('索引')
      } else {
        const artifact = await f.create()
        if (target === 'artifact') {
          rmSync(artifact.rootPath, { recursive: true })
          symlinkSync(f.base, artifact.rootPath)
        } else symlinkSync(f.base, join(artifact.rootPath, 'escape'))
        await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow('符号链接')
        expect(f.calls).toHaveLength(0)
      }
    })
  }
  test('When 索引被改成越界或错误 kind Then 不打开该记录', async () => {
    const f = fixture()
    const artifact = await f.create()
    const index = join(f.storage, 'design-artifacts.json')
    const data = JSON.parse(readFileSync(index, 'utf8')) as { artifacts: Array<{ rootPath: string; kind: string }> }
    data.artifacts[0]!.rootPath = f.base
    writeFileSync(index, JSON.stringify({ version: 1, ...data }))
    await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow('越界')
    data.artifacts[0]!.rootPath = artifact.rootPath; data.artifacts[0]!.kind = 'shell'
    writeFileSync(index, JSON.stringify({ version: 1, ...data }))
    await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow('非法记录')
  })
  test('When 并发重复打开 Then 只启动一次且使用随机 loopback 端口', async () => {
    const f = fixture()
    const artifact = await f.create()
    const results = await Promise.all(Array.from({ length: 8 }, () => f.service.openDesignArtifact('w1', artifact.id)))
    expect(new Set(results.map((item) => item.url)).size).toBe(1)
    expect(f.calls).toEqual([['open', artifact.rootPath, '--port', '0', '--host', '127.0.0.1']])
    expect(readFileSync(join(f.storage, 'design-artifacts.json'), 'utf8')).not.toContain('editorUrl')
    await f.service.stopDesignEditors()
    expect(f.calls.at(-1)).toEqual(['stop', artifact.rootPath])
  })
  test('When 重启恢复或上游复用其他宿主服务 Then 不抢占进程所有权', async () => {
    const f = fixture()
    const artifact = await f.create()
    f.reused(true)
    const restored = createDesignArtifactService(f.deps)
    expect(await restored.listDesignArtifacts('w1')).toHaveLength(1)
    await restored.openDesignArtifact('w1', artifact.id)
    await restored.stopDesignEditors()
    expect(f.calls.map((item) => item[0])).toEqual(['open'])
  })
  test('When 服务状态被换成另一个进程 Then 退出不会误杀该进程', async () => {
    const f = fixture()
    const artifact = await f.create()
    await f.service.openDesignArtifact('w1', artifact.id)
    writeFileSync(join(artifact.rootPath, '.artifact-server.json'), JSON.stringify({ root: artifact.rootPath, url: 'http://127.0.0.1:49152/', pid: 999 }))
    await f.service.stopDesignEditors()
    expect(f.calls.map((item) => item[0])).toEqual(['open'])
  })
  for (const url of ['http://localhost:49152/', 'http://192.168.1.1:49152/', 'http://127.0.0.1:0/', 'https://127.0.0.1:49152/', 'http://127.0.0.1/', 'http://user:pass@127.0.0.1:49152/']) {
    test(`When 服务返回不合规地址 ${url} Then 拒绝加载`, async () => {
      const f = fixture()
      const artifact = await f.create()
      f.returnedUrl(url)
      await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow('127.0.0.1')
    })
  }
  test('When 并发退出 Then 同一作品只回收一次', async () => {
    const f = fixture()
    const artifact = await f.create()
    await f.service.openDesignArtifact('w1', artifact.id)
    await Promise.all([f.service.stopDesignEditors(), f.service.stopDesignEditors()])
    expect(f.calls.filter((args) => args[0] === 'stop')).toHaveLength(1)
  })
  test('When 已打开服务状态被替换 Then 再次打开重新核验而非返回旧缓存', async () => {
    const f = fixture()
    const artifact = await f.create()
    await f.service.openDesignArtifact('w1', artifact.id)
    writeFileSync(join(artifact.rootPath, '.artifact-server.json'), '{}')
    f.reused(true)
    await f.service.openDesignArtifact('w1', artifact.id)
    await f.service.stopDesignEditors()
    expect(f.calls.map((args) => args[0])).toEqual(['open', 'open'])
  })
  test('When 项目根自身为链接或文件 Then 拒绝作品写入', async () => {
    for (const asLink of [false, true]) {
      const f = fixture()
      rmSync(f.project, { recursive: true })
      if (asLink) symlinkSync(f.base, f.project)
      else writeFileSync(f.project, '不是目录')
      await expect(f.create()).rejects.toThrow(asLink ? '符号链接' : '根目录不可用')
    }
  })
  test('When 后续会话改属项目 Then 已存在作品不能继续打开', async () => {
    const f = fixture()
    const artifact = await f.create()
    f.sessionWorkspace('different')
    await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow('不属于')
    expect(f.calls).toHaveLength(0)
  })
  test('When 某作品关联会话已失效 Then 作品库保留其记录而不阻塞整个列表', async () => {
    const f = fixture()
    const artifact = await f.create()
    f.sessionWorkspace('different')
    const listed = await f.service.listDesignArtifacts('w1')
    expect(listed[0]?.id).toBe(artifact.id)
    expect(listed[0]?.unavailableReason).toContain('不属于')
  })
  test('When 作品曾在外部打开 LAN 或 Agent Hook Then 在启动编辑器前拒绝恢复', async () => {
    for (const [file, state] of [['.sharing.json', {lan:true}], ['.artifact-server.json', {agentHook:'do-not-run'}]] as const) {
      const f = fixture()
      const artifact = await f.create()
      writeFileSync(join(artifact.rootPath, file), JSON.stringify(state))
      await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow()
      expect(f.calls).toHaveLength(0)
    }
  })
  test('When 索引 JSON 已损坏 Then 明确失败而非重建覆盖', async () => {
    const f = fixture()
    writeFileSync(join(f.storage, 'design-artifacts.json'), '{ broken')
    await expect(f.create()).rejects.toThrow('索引损坏')
    expect(readFileSync(join(f.storage, 'design-artifacts.json'), 'utf8')).toBe('{ broken')
  })
  test('When 随机端口没有就绪 Then 明确失败且仍可回收本次服务', async () => {
    const f = fixture()
    const artifact = await f.create()
    f.ready(false)
    await expect(f.service.openDesignArtifact('w1', artifact.id)).rejects.toThrow('未就绪')
    await f.service.stopDesignEditors()
    expect(f.calls.at(-1)?.[0]).toBe('stop')
  })
})
