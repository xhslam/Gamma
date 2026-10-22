import * as React from 'react'
import type { SDKContentBlock, SDKMessage } from '@gamma/shared'
import { useToolExecution } from './use-tool-execution'

/** 只将当前节点的内容路由到极简展示，最终答案与普通工具卡不受影响。 */
export const ProcessTimelineContext = React.createContext<SDKContentBlock | null>(null)

interface ProcessTimelineStepProps {
  block: SDKContentBlock
  allMessages: SDKMessage[]
  isStreaming?: boolean
  isLast: boolean
  children: React.ReactNode
}

export function ProcessTimelineStep({ block, allMessages, isStreaming, isLast, children }: ProcessTimelineStepProps): React.ReactElement {
  const toolId = block.type === 'tool_use' && typeof block.id === 'string' ? block.id : ''
  const { presentation } = useToolExecution(toolId, allMessages, isStreaming)
  // 思考始终使用灰点；只有实际运行的工具显示琥珀色转圈环。
  const status = toolId ? presentation.status : 'recorded'
  const running = status === 'running' || status === 'approval-submitting'

  return (
    <div className="process-timeline-step" data-process-step-status={status}>
      {!isLast && <span data-process-step-connector="" className="process-timeline-connector" aria-hidden="true" />}
      <span
        role="img"
        aria-label={toolId ? presentation.label : '思考记录'}
        data-process-step-indicator=""
        data-status={status}
        data-process-node-running={running ? '' : undefined}
        className="process-timeline-node"
      />
      <ProcessTimelineContext.Provider value={block}>
        <div className="min-w-0">{children}</div>
      </ProcessTimelineContext.Provider>
    </div>
  )
}
