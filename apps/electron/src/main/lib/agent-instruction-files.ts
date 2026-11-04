import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillFileContent } from '@gamma/shared'
import { getConfigDir } from './config-paths'
import type { GammaProjectInstructionFile } from './adapters/pi-resource-loader-overrides'

// 沿用工作区 AGENTS.md 的文件大小限制。
const AGENTS_FILE_SIZE_LIMIT = 10 * 1024 * 1024

export function getGlobalAgentsMdPath(): string {
  return join(getConfigDir(), 'AGENTS.md')
}

/** 全局与工作区规则共用读取契约；无内容缓存，每次调用重新读取。 */
export function readAgentsMdFile(path: string): SkillFileContent {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { relativePath: 'AGENTS.md', isText: true, size: 0, content: '' }
    }
    throw error
  }
  if (!stat.isFile()) throw new Error('AGENTS.md 不是文件')
  if (stat.size > AGENTS_FILE_SIZE_LIMIT) {
    throw new Error('AGENTS.md 超过 10 MB 限制，已跳过加载')
  }
  const bytes = readFileSync(path)
  if (bytes.length > AGENTS_FILE_SIZE_LIMIT) throw new Error('AGENTS.md 超过 10 MB 限制，已跳过加载')
  const binary = bytes.includes(0)
  return {
    relativePath: 'AGENTS.md',
    isText: !binary,
    size: bytes.length,
    content: binary ? undefined : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
  }
}

/** 全局层不依赖工作区存在；任何读取错误只影响该层，不影响对话启动。 */
export function readGlobalAgentsInstruction(
  path?: string,
  warn: (message: string) => void = console.warn,
): GammaProjectInstructionFile | undefined {
  try {
    path ??= getGlobalAgentsMdPath()
    const file = readAgentsMdFile(path)
    if (!file.isText) throw new Error('AGENTS.md 不是有效的 UTF-8 文本')
    return file.content ? { path, content: file.content } : undefined
  } catch (error) {
    warn(`[全局指令] ${path ?? '用户配置目录/AGENTS.md'}: 读取失败，已跳过本层: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
