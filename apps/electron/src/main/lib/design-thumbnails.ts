import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import type { DesignArtifact } from '@gamma/shared'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentWorkspacePath } from './config-paths'
import { readJsonFileSafe, writeTextFileAtomic } from './safe-file'

interface ThumbnailIndex { images: Record<string, string> }
function indexPath(workspaceId: string): string {
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) throw new Error('项目不存在')
  const path = join(getAgentWorkspacePath(workspace.slug), 'design-thumbnails.json')
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat && (stat.isSymbolicLink() || !stat.isFile() || stat.size > 25 * 1024 * 1024)) throw new Error('设计缩略图索引不可用')
  return path
}
function readIndex(path: string): ThumbnailIndex {
  const data = readJsonFileSafe<ThumbnailIndex>(path)
  if (!data || typeof data.images !== 'object' || !data.images || Array.isArray(data.images)) return { images: {} }
  return { images: Object.fromEntries(Object.entries(data.images).filter(([id, image]) => /^[a-f0-9-]{36}$/.test(id) && typeof image === 'string' && image.startsWith('data:image/png;base64,') && image.length < 300_000)) }
}
export function addDesignThumbnails(artifacts: DesignArtifact[], workspaceId: string): Array<DesignArtifact & { thumbnailDataUrl?: string }> {
  const index = readIndex(indexPath(workspaceId))
  return artifacts.map((artifact) => ({ ...artifact, thumbnailDataUrl: index.images[artifact.id] }))
}
/** 仅保存已校验本地编辑器页面的截图；API 与模型凭据从不进入图片。 */
export function saveDesignThumbnail(artifact: DesignArtifact, pngBase64: string): void {
  const path = indexPath(artifact.workspaceId)
  const image = nativeImage.createFromBuffer(Buffer.from(pngBase64, 'base64'))
  if (image.isEmpty()) return
  const png = image.resize({ width: 480, quality: 'good' }).toPNG()
  if (png.byteLength > 200_000) return
  const index = readIndex(path)
  delete index.images[artifact.id]
  index.images[artifact.id] = `data:image/png;base64,${png.toString('base64')}`
  const entries = Object.entries(index.images).slice(-80)
  writeTextFileAtomic(path, JSON.stringify({ images: Object.fromEntries(entries) }))
}
