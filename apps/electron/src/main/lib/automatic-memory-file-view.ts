import path from 'node:path'
import { AutomaticMemoryStore } from './automatic-memory-store'
import type { MemoryVirtualFile } from './memory-catalog'
import { patchMemoryMetadata } from './memory-metadata'

/** 对已有权威记录建立只读文件视图；没有副本、没有独立写入或删除入口。 */
export function createAutomaticMemoryFileView(workspaceMemoryRoot: string, workspaceSlug: string): () => Promise<MemoryVirtualFile[]> {
  const store = new AutomaticMemoryStore({ resolveWorkspaceRoot: () => path.dirname(workspaceMemoryRoot) })
  return async () => store.getRetrievalEntries(workspaceSlug).map(entry => {
    const directory = entry.category === 'profile' ? 'topics' : entry.category
    const filename = `auto-${entry.id}.md`
    const isPreferences = entry.category === 'profile' && /偏好|习惯|风格|回答|preference/i.test(entry.title)
    const body = entry.content.split(/\r?\n/).filter(Boolean).map(line => line.startsWith('- [stated] ') ? line : `- [stated] ${line}`).join('\n') + '\n'
    return {
      path: `workspace:/${directory}/${filename}`, title: entry.title, updatedAt: entry.updatedAt,
      ...(entry.category === 'profile' ? { alwaysInject: isPreferences ? 'preferences' as const : 'profile' as const } : {}),
      content: patchMemoryMetadata(body, { name: filename, description: `${entry.title}相关事实，涉及${entry.title}时读取`.slice(0, 150), aliases: [entry.title], sources: [`automatic:${entry.id}`] }),
    }
  })
}
