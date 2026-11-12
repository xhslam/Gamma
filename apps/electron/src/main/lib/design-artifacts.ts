import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { DesignArtifact, DesignArtifactKind, DesignCreateArtifactInput, DesignOpenArtifactResult } from '../../../../../packages/shared/src/types/design-workbench'
import { readJsonFileSafe, writeTextFileAtomic } from './safe-file'

const KINDS: readonly DesignArtifactKind[] = ['slides', 'canvas', 'system', 'dashboard', 'motion', 'whiteboard']
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
interface Workspace { id: string; slug: string; projectRootPath?: string }
interface Session { workspaceId?: string }
interface CommandResult { stdout: string }
/** 依赖注入只用于独立测试；生产入口始终读取 Gamma 工作区与会话授权。 */
export interface DesignArtifactDependencies {
  getWorkspace(id: string): Workspace | undefined | Promise<Workspace | undefined>
  getSession(id: string): Session | undefined | Promise<Session | undefined>
  getWorkspacePath(slug: string): string | Promise<string>
  getSkillPath(kind: DesignArtifactKind): string | Promise<string>
  run(kind: DesignArtifactKind, args: string[], options: { cwd: string }): Promise<string | CommandResult>
  probe(url: string): Promise<boolean>
}
interface Context { workspace: Workspace; storage: string; root: string; index: string }
interface OwnedEditor { artifact: DesignArtifact; url: string; pid: number }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function kind(value: unknown): value is DesignArtifactKind { return KINDS.includes(value as DesignArtifactKind) }
function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'))
}
function directory(path: string): string {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) throw new Error(`作品目录不允许符号链接: ${path}`)
  if (!stat?.isDirectory()) throw new Error(`作品根目录不可用: ${path}`)
  return realpathSync(path)
}
/** 只走授权根下明确指定的路径，不扫描用户项目。 */
function safePath(root: string, target: string, create = false): string {
  if (!within(root, target)) throw new Error('作品路径越界')
  let current = root
  for (const part of relative(root, target).split('/').filter(Boolean)) {
    current = join(current, part)
    let stat = lstatSync(current, { throwIfNoEntry: false })
    if (!stat && create) { mkdirSync(current); stat = lstatSync(current) }
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error(`作品路径不可用或含符号链接: ${current}`)
  }
  if (!within(root, realpathSync(target))) throw new Error('作品真实路径越界')
  return target
}
function safeIndex(path: string): void {
  for (const suffix of ['', '.tmp', '.bak']) {
    const stat = lstatSync(path + suffix, { throwIfNoEntry: false })
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)) throw new Error('作品索引不可用或含链接')
  }
}
/** 编辑器会读写整个作品；拒绝作品内部的链接与特殊文件。 */
function safeTree(root: string): void {
  let count = 0
  const visit = (path: string, depth: number): void => {
    if (++count > 20_000 || depth > 32) throw new Error('作品文件数量或深度超出安全限制')
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) throw new Error('作品包含符号链接、硬链接或特殊文件')
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name), depth + 1)
  }
  visit(root, 0)
}
/** 不允许上游恢复在 Gamma 外开启过的 LAN 或任意 shell hook。 */
function assertLocalOnlyState(root: string): void {
  const sharing = join(root, '.sharing.json')
  if (lstatSync(sharing, { throwIfNoEntry: false })) {
    const state: unknown = JSON.parse(readFileSync(sharing, 'utf8'))
    if (!record(state) || state.lan === true) throw new Error('作品保存了已开启的局域网共享状态，请先手动关闭共享后再打开')
  }
  const running = join(root, '.artifact-server.json')
  if (lstatSync(running, { throwIfNoEntry: false })) {
    const state: unknown = JSON.parse(readFileSync(running, 'utf8'))
    if (!record(state) || (Array.isArray(state.lan) && state.lan.length) || state.lan === true || state.agentHook) throw new Error('作品保留了局域网共享或 Agent Hook，拒绝复用该服务')
  }
}

function readIndex(ctx: Context): DesignArtifact[] {
  safeIndex(ctx.index)
  const data = readJsonFileSafe<unknown>(ctx.index)
  if (data === null) {
    if (lstatSync(ctx.index, { throwIfNoEntry: false })) throw new Error('作品索引损坏，未覆盖原文件')
    return []
  }
  if (!record(data) || data.version !== 1 || !Array.isArray(data.artifacts)) throw new Error('作品索引格式错误')
  const ids = new Set<string>()
  return data.artifacts.map((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)
      || item.workspaceId !== ctx.workspace.id || typeof item.sessionId !== 'string' || !item.sessionId
      || typeof item.title !== 'string' || !item.title.trim() || !kind(item.kind)
      || typeof item.rootPath !== 'string' || !isAbsolute(item.rootPath)
      || basename(item.rootPath) !== item.id || basename(dirname(item.rootPath)) !== 'designs'
      || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)
      || typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)
      || (item.lastOpenedAt !== undefined && (typeof item.lastOpenedAt !== 'number' || !Number.isFinite(item.lastOpenedAt)))) throw new Error('作品索引包含非法记录或越界路径')
    ids.add(item.id)
    return { id: item.id, workspaceId: ctx.workspace.id, sessionId: item.sessionId, title: item.title,
      // 项目改名/迁移后只使用当前授权根，不访问索引里的旧目录。
      kind: item.kind, rootPath: join(ctx.root, item.id), createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(typeof item.lastOpenedAt === 'number' ? { lastOpenedAt: item.lastOpenedAt } : {}) }
  })
}
function saveIndex(ctx: Context, artifacts: DesignArtifact[]): void {
  safeIndex(ctx.index)
  writeTextFileAtomic(ctx.index, JSON.stringify({ version: 1, artifacts: artifacts.map(({ editorUrl: _url, ...item }) => item) }, null, 2))
}
function json(path: string, data: object): void {
  mkdirSync(dirname(path), { recursive: true })
  writeTextFileAtomic(path, JSON.stringify(data, null, 2))
}
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}
/** 全为 Gamma 自有空白模板，不分发上游混合许可资产。 */
function seed(artifact: DesignArtifact): void {
  const { rootPath: root, title, kind: type } = artifact
  const createdOnFiles = { v: 1, at: new Date(artifact.createdAt).toISOString() }
  const heading = escapeHtml(title)
  if (type === 'slides') {
    json(join(root, 'project/deck.json'), { v: 4, createdOnFiles, lists: 'css', title, order: ['cover'], cover: 'cover', sections: {}, faces: {}, designSystems: [] })
    mkdirSync(join(root, 'project/slides'))
    writeTextFileAtomic(join(root, 'project/slides/cover.html'), `<section id="cover" style="background:#fafafa;color:#18181b;display:flex;align-items:center;justify-content:center"><h1 style="font:64px sans-serif">${heading}</h1></section>`)
  } else if (type === 'canvas') {
    json(join(root, 'project/canvas.json'), { v: 3, createdOnFiles, title, launch: { view: 'canvas' }, pages: [], boards: { 'Main.dc.html': { x: 0, y: 0, w: 880, h: 560 } }, order: ['Main.dc.html'], notes: {}, designSystems: [] })
    writeTextFileAtomic(join(root, 'project/Main.dc.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title><script src="./support.js"></script></head><body><x-dc><helmet><style>body{margin:0}</style></helmet><div style="width:880px;height:560px;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#18181b;font-family:sans-serif"><h1>${heading}</h1></div></x-dc><script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":880,"height":560}}'>class Component extends DCLogic { renderVals() { return {}; } }</script></body></html>`)
  } else if (type === 'system') {
    json(join(root, 'project/design-system.json'), { v: 3, layout: 'files', createdOnFiles, title, namespace: 'Gamma', libraries: [], sections: {}, groups: [], assetGroups: {}, blobs: {}, docs: { sections: [] } })
    json(join(root, 'project/tokens.json'), {})
    writeTextFileAtomic(join(root, 'project/README.md'), `# ${title}\n\n待创作的空白设计系统。\n`)
    mkdirSync(join(root, 'project/components/Cover'), { recursive: true })
    writeTextFileAtomic(join(root, 'project/components/Cover/preview.html'), `<!-- @dsCard height=288 -->\n<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="height:288px;display:grid;place-items:center;background:#fafafa;color:#18181b;font-family:sans-serif"><h1>${heading}</h1></main></body></html>`)
  } else if (type === 'dashboard') {
    json(join(root, 'db/dash/meta.json'), { title })
    json(join(root, 'db/files/index.html.json'), { text: `<!doctype html><html><head><title>${heading}</title><style>body{margin:0;font-family:sans-serif;background:#fafafa;color:#18181b}main{padding:48px}</style></head><body><main><h1>${heading}</h1></main></body></html>` })
  } else if (type === 'whiteboard') {
    json(join(root, 'db/board/meta.json'), { v: 1, title, order: [] })
  } else {
    json(join(root, 'db/film/meta.json'), { v: 1, title, updatedAt: createdOnFiles.at })
    json(join(root, 'db/modules/scenes.json.json'), { kind: 'json', text: JSON.stringify({ v: 1, stage: 'rough', width: 1280, height: 720, fps: 30, background: '#fafafa', scenes: [{ id: 'intro', name: '空白画面', dur: 5, desc: '待创作' }] }) })
    json(join(root, 'db/modules/scene-intro.js.json'), { kind: 'js', text: 'kit.scene("intro", { init(kit) { kit.stage.append(kit.h(\'<div style="position:absolute;inset:0;background:#fafafa"></div>\')); }, render() {} });' })
    json(join(root, 'db/film/script.json'), { code: 'window.CUT = kit.scenes();' })
  }
}
/** 标题与修改时间读取原版文件，用户在编辑器的改名不应只留在旧索引快照中。 */
function summarizeArtifact(artifact: DesignArtifact): DesignArtifact {
  const paths: Record<DesignArtifactKind, string> = {
    slides: 'project/deck.json', canvas: 'project/canvas.json', system: 'project/design-system.json',
    dashboard: 'db/dash/meta.json', motion: 'db/film/meta.json', whiteboard: 'db/board/meta.json',
  }
  try {
    const path = join(artifact.rootPath, paths[artifact.kind])
    safePath(artifact.rootPath, dirname(path))
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 2 * 1024 * 1024) return artifact
    const meta: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const title = record(meta) && typeof meta.title === 'string' && meta.title.trim() && meta.title.length <= 120 ? meta.title.trim() : artifact.title
    return { ...artifact, title, updatedAt: Math.max(artifact.updatedAt, Math.floor(stat.mtimeMs)) }
  } catch { return artifact }
}

function parseCommand(result: string | CommandResult): Record<string, unknown> {
  const parsed: unknown = JSON.parse(typeof result === 'string' ? result : result.stdout)
  if (!record(parsed)) throw new Error('编辑器返回无效 JSON')
  return parsed
}
function loopback(value: unknown): string {
  if (typeof value !== 'string') throw new Error('编辑器未返回地址')
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1 || Number(url.port) > 65535 || url.username || url.password || url.hash) throw new Error('编辑器地址必须为带真实端口的 127.0.0.1 HTTP 地址')
  return url.href
}

export function createDesignArtifactService(deps: DesignArtifactDependencies) {
  const locks = new Map<string, Promise<unknown>>()
  const opened = new Map<string, OwnedEditor>()
  let stopping = false
  let stopOperation: Promise<void> | undefined
  async function locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (stopping) throw new Error('设计编辑器正在退出')
    const previous = locks.get(id) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(work)
    locks.set(id, operation)
    try { return await operation } finally { if (locks.get(id) === operation) locks.delete(id) }
  }
  async function context(id: string): Promise<Context> {
    if (typeof id !== 'string' || !id) throw new Error('请先选择项目')
    const workspace = await deps.getWorkspace(id)
    if (!workspace || workspace.id !== id || !/^[A-Za-z0-9_-]+$/.test(workspace.slug)) throw new Error('项目不存在或目录无效')
    const storage = directory(await deps.getWorkspacePath(workspace.slug))
    const project = workspace.projectRootPath ? directory(resolve(workspace.projectRootPath)) : safePath(storage, join(storage, 'workspace-files'), true)
    const root = safePath(project, join(project, 'designs'), true)
    return { workspace, storage, root, index: join(storage, 'design-artifacts.json') }
  }
  async function session(artifact: Pick<DesignArtifact, 'workspaceId' | 'sessionId'>): Promise<void> {
    const meta = await deps.getSession(artifact.sessionId)
    if (!meta || meta.workspaceId !== artifact.workspaceId) throw new Error('作品会话不存在或不属于当前项目')
  }
  async function listDesignArtifacts(workspaceId: string): Promise<DesignArtifact[]> {
    return locked(workspaceId, async () => {
      const ctx = await context(workspaceId)
      const artifacts = readIndex(ctx)
      const entries: DesignArtifact[] = []
      for (const artifact of artifacts) {
        let unavailableReason: string | undefined
        try { await session(artifact); safePath(ctx.root, artifact.rootPath) }
        catch (error) { unavailableReason = error instanceof Error ? error.message : '作品暂不可用' }
        entries.push({ ...(unavailableReason ? artifact : summarizeArtifact(artifact)), ...(unavailableReason ? { unavailableReason } : {}) })
      }
      return entries.map((artifact) => ({ ...artifact, ...(opened.has(`${workspaceId}/${artifact.id}`) ? { editorUrl: opened.get(`${workspaceId}/${artifact.id}`)!.url } : {}) }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }
  async function createDesignArtifact(input: DesignCreateArtifactInput): Promise<DesignArtifact> {
    if (!input || !kind(input.kind)) throw new Error('不支持的作品类型')
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120 || /[\x00-\x1f]/.test(input.title)) throw new Error('作品标题须为 1–120 个字符')
    if (typeof input.sessionId !== 'string' || !input.sessionId) throw new Error('请选择作品关联会话')
    return locked(input.workspaceId, async () => {
      const ctx = await context(input.workspaceId)
      await session(input)
      await deps.getSkillPath(input.kind)
      const artifacts = readIndex(ctx)
      const now = Date.now()
      const id = randomUUID()
      const artifact: DesignArtifact = { id, workspaceId: input.workspaceId, sessionId: input.sessionId,
        title: input.title.trim(), kind: input.kind, rootPath: join(ctx.root, id), createdAt: now, updatedAt: now }
      mkdirSync(artifact.rootPath)
      try { seed(artifact); saveIndex(ctx, [...artifacts, artifact]) }
      catch (error) { rmSync(artifact.rootPath, { recursive: true, force: true }); throw error }
      return artifact
    })
  }
  /** 下载与交接必须重新核验索引、会话归属和整个文件树，不能信任 renderer 缓存的路径。 */
  async function getDesignArtifact(workspaceId: string, id: string): Promise<DesignArtifact> {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('无效作品 ID')
    return locked(workspaceId, async () => {
      const ctx = await context(workspaceId)
      const artifact = readIndex(ctx).find((item) => item.id === id)
      if (!artifact) throw new Error('作品不存在或不属于当前项目')
      await session(artifact)
      safePath(ctx.root, artifact.rootPath)
      safeTree(artifact.rootPath)
      assertLocalOnlyState(artifact.rootPath)
      return summarizeArtifact(artifact)
    })
  }
  async function openDesignArtifact(workspaceId: string, id: string): Promise<DesignOpenArtifactResult> {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('无效作品 ID')
    return locked(workspaceId, async () => {
      const ctx = await context(workspaceId)
      const artifacts = readIndex(ctx)
      const artifact = artifacts.find((item) => item.id === id)
      if (!artifact) throw new Error('作品不存在或不属于当前项目')
      await session(artifact)
      safePath(ctx.root, artifact.rootPath)
      safeTree(artifact.rootPath)
      assertLocalOnlyState(artifact.rootPath)
      await deps.getSkillPath(artifact.kind)
      const key = `${workspaceId}/${id}`
      const existing = opened.get(key)
      let existingState: unknown
      try { existingState = JSON.parse(readFileSync(join(artifact.rootPath, '.artifact-server.json'), 'utf8')) } catch { /* 尚未启动，或之前的服务已退出。 */ }
      const sameServer = existing && record(existingState) && existingState.pid === existing.pid
        && existingState.root === artifact.rootPath && existingState.url === existing.url
      let url: string
      if (existing && sameServer && await deps.probe(existing.url)) url = existing.url
      else {
        opened.delete(key)
        const result = parseCommand(await deps.run(artifact.kind, ['open', artifact.rootPath, '--port', '0', '--host', '127.0.0.1'], { cwd: artifact.rootPath }))
        url = loopback(result.url)
        if (!Number.isInteger(result.pid) || (result.pid as number) <= 0) throw new Error('编辑器未返回有效进程标识')
        if (result.root !== artifact.rootPath) throw new Error('编辑器返回的作品根不匹配')
        safePath(ctx.root, artifact.rootPath)
        safeTree(artifact.rootPath)
        const state: unknown = JSON.parse(readFileSync(join(artifact.rootPath, '.artifact-server.json'), 'utf8'))
        if (!record(state) || state.pid !== result.pid || state.url !== url || state.root !== artifact.rootPath) throw new Error('编辑器运行状态与启动结果不匹配')
        // reused 服务可能由其他宿主启动；绝不把它登记为本进程所有。
        if (result.reused !== true) opened.set(key, { artifact, url, pid: result.pid as number })
        if (Array.isArray(result.lan) && result.lan.length) throw new Error('不允许打开启用 LAN 的编辑器')
        if (!await deps.probe(url)) throw new Error('编辑器端口未就绪')
      }
      const updated = { ...summarizeArtifact(artifact), lastOpenedAt: Date.now() }
      saveIndex(ctx, artifacts.map((item) => item.id === id ? updated : item))
      return { artifact: { ...updated, editorUrl: url }, url }
    })
  }
  async function stopOwnedEditors(): Promise<void> {
    try {
      await Promise.allSettled([...locks.values()])
      const failures: unknown[] = []
      for (const [id, editor] of opened) {
        try {
          const ctx = await context(editor.artifact.workspaceId)
          safePath(ctx.root, editor.artifact.rootPath)
          safeTree(editor.artifact.rootPath)
          const statePath = join(editor.artifact.rootPath, '.artifact-server.json')
          const state: unknown = JSON.parse(readFileSync(statePath, 'utf8'))
          if (record(state) && state.pid === editor.pid && state.url === editor.url && state.root === editor.artifact.rootPath) {
            const result = parseCommand(await deps.run(editor.artifact.kind, ['stop', editor.artifact.rootPath], { cwd: editor.artifact.rootPath }))
            if (result.stopped !== true) throw new Error('编辑器未确认停止')
          }
          opened.delete(id)
        } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, '部分设计编辑器未能安全回收')
    } finally { stopping = false }
  }
  function stopDesignEditors(): Promise<void> {
    if (stopOperation) return stopOperation
    stopping = true
    stopOperation = stopOwnedEditors().finally(() => { stopOperation = undefined })
    return stopOperation
  }
  return { listDesignArtifacts, createDesignArtifact, getDesignArtifact, openDesignArtifact, stopDesignEditors }
}

const service = createDesignArtifactService({
  getWorkspace: async (id) => (await import('./agent-workspace-manager')).getAgentWorkspace(id),
  getSession: async (id) => (await import('./agent-session-manager')).getAgentSessionMeta(id),
  getWorkspacePath: async (slug) => (await import('./config-paths')).getAgentWorkspacePath(slug),
  getSkillPath: async (type) => (await import('./design-bundle')).getDesignBundleSkillPath(type),
  run: async (type, args) => (await import('./design-bundle')).runDesignArtifactCommand(type, args, { timeoutMs: 30_000 }),
  probe: async (url) => {
    try { const response = await fetch(loopback(url), { redirect: 'error', signal: AbortSignal.timeout(2500) }); await response.body?.cancel(); return response.ok } catch { return false }
  },
})
export const { listDesignArtifacts, createDesignArtifact, getDesignArtifact, openDesignArtifact, stopDesignEditors } = service
