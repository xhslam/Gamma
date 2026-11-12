import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import type { DesignArtifact, DesignHandoffResult } from '@gamma/shared'
import { writeTextFileAtomic } from './safe-file'

const JUNK = new Set(['.git', '.DS_Store', 'Thumbs.db'])
const ROOT_LOCAL = new Set(['.artifact-server.json', '.artifact-server.log', '.sharing.json'])
const MAX_BYTES = 256 * 1024 * 1024

export interface DesignDeliveryDependencies {
  getArtifact(workspaceId: string, artifactId: string): Promise<DesignArtifact>
  getWorkbench(artifact: DesignArtifact): Promise<string>
  getSkillPath(artifact: DesignArtifact): Promise<string>
  flush(artifact: DesignArtifact): Promise<void>
  archive(artifact: DesignArtifact, root: string, output: string): Promise<void>
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'))
}

/** 逐个复制普通文件，不跟随链接；输出目录由主进程分配，绝不接收页面路径。 */
async function copyDesignTree(source: string, target: string): Promise<number> {
  const root = await realpath(source)
  let bytes = 0
  let files = 0
  const walk = async (directory: string, destination: string, depth: number): Promise<void> => {
    if (depth > 32) throw new Error('设计稿目录过深')
    if (!within(root, await realpath(directory))) throw new Error('设计稿路径越界')
    await mkdir(destination, { recursive: true })
    for (const name of (await readdir(directory)).sort()) {
      if (JUNK.has(name) || name.endsWith('.tmp') || name.startsWith('.tmp-')) continue
      const from = join(directory, name)
      const to = join(destination, name)
      const info = await lstat(from)
      // 仅作品根目录的旧导出和本机状态需要排除；嵌套同名目录可能是合法素材或数据 collection。
      if (depth === 0 && (ROOT_LOCAL.has(name) || name === 'exports' && info.isDirectory())) continue
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || info.nlink > 1 && info.isFile()) throw new Error('设计稿包含链接或特殊文件')
      if (info.isDirectory()) { await walk(from, to, depth + 1); continue }
      if (++files > 20_000 || (bytes += info.size) > MAX_BYTES) throw new Error('完整设计稿超出 256MB 或文件数量限制')
      const input = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await input.stat()
        if (!stat.isFile() || stat.nlink > 1 || stat.size !== info.size || !within(root, await realpath(from))) throw new Error('设计稿文件在复制时发生变化，请重试')
        const data = await input.readFile()
        if (data.byteLength !== info.size) throw new Error('设计稿正在写入，请等待保存完成后重试')
        const output = await open(to, 'wx', 0o600)
        try { await output.writeFile(data) } finally { await output.close() }
      } finally { await input.close() }
    }
  }
  await walk(source, target, 0)
  if (!files) throw new Error('设计稿为空，无法导出')
  return files
}

export function buildDesignImplementationPrompt(artifact: DesignArtifact, snapshotPath: string, skillPath: string): string {
  return [
    `请根据完整设计稿「${artifact.title}」在当前项目中实施。这是应用代码实施需求，不是继续修改设计画板。`,
    `完整设计稿目录：${JSON.stringify(snapshotPath)}。已附上同一份 ZIP；直接读取解包目录，不要只根据截图或聊天摘要推测。`,
    `设计格式参考：${JSON.stringify(join(skillPath, 'SKILL.md'))}。作品类型：${artifact.kind}。`,
    '先检查完整稿内的页面顺序、所有画板/幻灯片、元数据、样式、组件、交互说明及素材，再结合项目现有技术栈实施；不得只做当前可见页面。',
    '保留设计快照不变，不覆盖原始设计；复用项目组件与主题，保证响应式、键盘可用性和必要状态。设计未说明的真实数据与业务行为先说明，不伪造已接入能力。',
    '遵守当前项目规则，运行相关测试与类型检查并汇报完成范围和差异。不自动发布、付费、提交或推送。',
  ].join('\n\n')
}

export function createDesignDeliveryService(deps: DesignDeliveryDependencies) {
  const prepare = async (workspaceId: string, artifactId: string): Promise<DesignHandoffResult> => {
    let artifact = await deps.getArtifact(workspaceId, artifactId)
    await deps.flush(artifact)
    artifact = await deps.getArtifact(workspaceId, artifactId)
    const workbench = await deps.getWorkbench(artifact)
    const root = await realpath(workbench)
    const parent = join(root, 'design-handoffs')
    await mkdir(parent, { recursive: true })
    if ((await lstat(parent)).isSymbolicLink() || !within(root, await realpath(parent))) throw new Error('设计稿交接目录不可用')
    const delivery = await mkdtemp(join(parent, 'design-'))
    const snapshotPath = join(delivery, artifact.id)
    try {
      const fileCount = await copyDesignTree(artifact.rootPath, snapshotPath)
      const skill = await deps.getSkillPath(artifact)
      const archivePath = join(delivery, 'design.zip')
      await deps.archive(artifact, snapshotPath, archivePath)
      const archive = await lstat(archivePath)
      if (!archive.isFile() || archive.isSymbolicLink() || archive.nlink > 1 || archive.size <= 0 || archive.size > MAX_BYTES) throw new Error('完整设计稿归档未成功生成')
      const prompt = buildDesignImplementationPrompt(artifact, snapshotPath, skill)
      writeTextFileAtomic(join(delivery, 'handoff.json'), JSON.stringify({ version: 1, artifactId, sessionId: artifact.sessionId, title: artifact.title, snapshotPath, fileCount, createdAt: Date.now() }, null, 2))
      return { artifactId, sessionId: artifact.sessionId, title: artifact.title, snapshotPath, archivePath, archiveBytes: archive.size, fileCount, prompt }
    } catch (error) { await rm(delivery, { recursive: true, force: true }); throw error }
  }
  return { prepare }
}

/** 保存对话框已经负责覆盖确认；先复制到同目录临时文件再替换，失败不损坏旧成稿。 */
export async function saveDesignArchive(source: string, destination: string): Promise<void> {
  const parent = dirname(destination)
  const temporary = await mkdtemp(join(parent, '.gamma-design-'))
  const output = join(temporary, basename(destination))
  try {
    await copyFile(source, output, constants.COPYFILE_EXCL)
    await rename(output, destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
