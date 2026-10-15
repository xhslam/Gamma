import { relative } from 'node:path'

/** 内部权威记录不能经普通Markdown编辑器修改，避免绕过修订和删除屏蔽。 */
export function assertPublicMemoryFilePath(memoryDir: string, resolvedPath: string): void {
  const name = relative(memoryDir, resolvedPath).replace(/\\/g, '/').normalize('NFKC').toLowerCase()
  if (name === '.automatic-memory.json') throw new Error('自动分类记忆的内部记录只能通过分类记忆管理器访问')
}
