import type { SDKContentBlock, SDKTextBlock, SDKThinkingBlock, SDKToolUseBlock } from '@gamma/shared'
import { TASK_TOOL_NAMES } from './task-progress'

/** 空增量、空白和不可见占位符不应占据时间线节点；保留原始正文。 */
export function isVisibleProcessBlock(block: SDKContentBlock): boolean {
  if (block.type === 'tool_use') return !TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)
  if (block.type !== 'text' && block.type !== 'thinking') return false
  const text = block.type === 'text' ? (block as SDKTextBlock).text : (block as SDKThinkingBlock).thinking
  return text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '').length > 0
}
