import * as React from 'react'
import { useAtomValue } from 'jotai'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import { useMessageSessionId } from '@/components/ai-elements/message'
import { getToolExecutionPresentation } from '@/lib/tool-execution-presentation'
import type { SDKMessage, SDKToolResultBlock, SDKUserMessage } from '@gamma/shared'

interface ToolResultData {
  result?: string
  isError?: boolean
}

/** 在 allMessages 中查找匹配 toolUseId 的工具结果 */
export function useToolResult(toolUseId: string, allMessages: SDKMessage[]): ToolResultData | null {
  return React.useMemo(() => {
    if (!toolUseId) return null
    for (const msg of allMessages) {
      if (msg.type !== 'user') continue
      const userMsg = msg as SDKUserMessage
      const contentBlocks = userMsg.message?.content
      if (!Array.isArray(contentBlocks)) continue

      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const resultBlock = block as SDKToolResultBlock
          if (resultBlock.tool_use_id === toolUseId) {
            let result: string | undefined
            if (typeof resultBlock.content === 'string') {
              result = resultBlock.content
            } else if (Array.isArray(resultBlock.content)) {
              result = (resultBlock.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === 'text' && typeof c.text === 'string')
                .map((c) => c.text)
                .join('\n')
            }
            return { result, isError: resultBlock.is_error }
          }
        }
      }
    }
    return null
  }, [toolUseId, allMessages])
}

/** 工具卡与时间线共享结果证据，避免状态判定出现分歧。 */
export function useToolExecution(toolUseId: string, allMessages: SDKMessage[], isStreaming?: boolean) {
  const result = useToolResult(toolUseId, allMessages)
  const sessionId = useMessageSessionId()
  const pendingPermissions = useAtomValue(allPendingPermissionRequestsAtom)
  const pendingApproval = sessionId !== undefined && pendingPermissions.get(sessionId)
    ?.some((request) => request.toolUseId === toolUseId)
  const presentation = getToolExecutionPresentation({
    result,
    isStreaming,
    approval: pendingApproval ? 'pending' : undefined,
  })
  return { result, presentation }
}
