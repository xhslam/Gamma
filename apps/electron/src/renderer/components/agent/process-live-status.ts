import type { SDKContentBlock, SDKMessage, SDKToolUseBlock, SDKUserMessage } from '@gamma/shared'
import { getProcessActionLabel } from './process-timeline-presentation'

export interface ProcessLiveStatus {
  key: string
  label: string
  running: boolean
  waiting: boolean
}

const NO_APPROVALS: ReadonlySet<string> = new Set()

function compactAction(block: SDKToolUseBlock): string {
  const label = getProcessActionLabel(block)
  const object = label.object?.replace(/\s*\n\s*/g, ' ')
  const isFile = ['read', 'write', 'edit', 'notebookedit'].includes(block.name.toLowerCase())
  const shortObject = isFile ? object?.split(/[/\\]/).pop() || object : object
  return [label.action || '执行', shortObject].filter(Boolean).join(' ')
}

/** 结果按调用 ID 关联；并行调用中不能把“最新一个已结束”误当成全部结束。 */
export function getProcessLiveStatus(
  blocks: SDKContentBlock[],
  messages: SDKMessage[],
  streaming = false,
  pendingToolIds: ReadonlySet<string> = NO_APPROVALS,
  activeForm?: string,
): ProcessLiveStatus {
  const completed = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = (message as SDKUserMessage).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') completed.add(block.tool_use_id)
    }
  }
  const tools = blocks.filter((block): block is SDKToolUseBlock => block.type === 'tool_use')
  const unresolved = tools.filter((block) => !completed.has(block.id))
  const approval = unresolved.findLast((block) => pendingToolIds.has(block.id))
  const current = approval ?? unresolved.at(-1)
  if (streaming && current) {
    return {
      key: current.id,
      label: `${approval ? '等待确认 ' : '正在'}${compactAction(current)}`,
      running: !approval,
      waiting: !!approval,
    }
  }
  if (streaming) {
    const thinking = blocks.at(-1)?.type === 'thinking'
    const label = activeForm || (thinking ? '正在思考' : '正在整理回复')
    return { key: `action:${label}`, label, running: true, waiting: false }
  }
  const lastTool = tools.at(-1)
  return {
    key: lastTool?.id ?? 'record',
    label: lastTool ? compactAction(lastTool) : '整理回复',
    running: false,
    waiting: false,
  }
}

export function formatProcessElapsed(milliseconds: number): string {
  const seconds = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 1_000)) : 0
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
