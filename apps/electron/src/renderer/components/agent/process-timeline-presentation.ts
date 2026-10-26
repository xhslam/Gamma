import type { SDKToolUseBlock } from '@gamma/shared'
import { getToolPhrase } from './tool-phrase'

export interface ProcessActionLabel {
  action: string
  object?: string
  monospace?: boolean
}

function firstString(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/** 时间线只描述动作与对象，不把运行/成功/失败混进动作短语。 */
export function getProcessActionLabel(block: SDKToolUseBlock): ProcessActionLabel {
  const { name, input } = block
  const path = firstString(input, 'file_path', 'filePath', 'path', 'notebook_path')
  const intent = firstString(input, '_intent', 'description')
  switch (name.toLowerCase()) {
    case 'bash':
    case 'terminalexecute':
      return { action: intent?.replace(/^(?:正在)?执行\s*/, '') || '执行', object: firstString(input, 'command') ?? '命令', monospace: true }
    case 'read': return { action: '读取', object: path ?? '文件', monospace: !!path }
    case 'write': return { action: '写入', object: path ?? '文件', monospace: !!path }
    case 'edit':
    case 'notebookedit': return { action: '编辑', object: path ?? '文件', monospace: !!path }
    case 'ls': return { action: '列出', object: path ?? '目录', monospace: !!path }
    case 'grep': return { action: '搜索', object: [firstString(input, 'pattern'), path].filter(Boolean).join(' · ') || '内容', monospace: true }
    case 'glob':
    case 'find': return { action: '查找', object: firstString(input, 'pattern') ?? path ?? '文件', monospace: true }
    case 'webfetch': return { action: '读取', object: firstString(input, 'url') ?? '网页', monospace: true }
    case 'websearch': return { action: '搜索', object: firstString(input, 'query') ?? '网页' }
    case 'agent':
    case 'task': return { action: '委派', object: firstString(input, 'description', 'name', 'prompt') ?? '子任务' }
    case 'memory_read': return { action: '查阅记忆', object: path, monospace: true }
    case 'memory_write':
    case 'memory_append':
    case 'memory_str_replace': return { action: '更新记忆', object: path, monospace: true }
    default: {
      const phrase = intent ?? getToolPhrase(name, input).label
      // 未知工具与 MCP 的通用短语包含原始工具名；极简日志只保留动宾描述。
      if (!intent && (phrase.startsWith(name) || name.startsWith('mcp__'))) {
        const object = path ?? firstString(input, 'title', 'subject', 'query', 'url', 'name', 'prompt')
        return { action: '处理', object: object ?? '请求', monospace: !!path }
      }
      return { action: phrase.replace(/^正在/, '') }
    }
  }
}

/** 仅取错误首行；完整结果仍保留在用户主动展开的详情中。 */
export function getProcessErrorSummary(result?: string): string | undefined {
  const firstLine = result?.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((line) => line.trim())
  const summary = firstLine?.trim().replace(/^Error:\s*/i, '')
  return summary ? summary.slice(0, 180) : undefined
}
