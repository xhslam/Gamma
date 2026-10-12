import * as React from 'react'
import { normalizeReasoningCapabilityLevel } from '@gamma/shared'
import type { AgentThinkingLevel, ReasoningCapability } from '@gamma/shared'
import { Slider } from '../ui/slider'

const THINKING_LABELS: Record<AgentThinkingLevel, string> = {
  off: '关闭', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大',
}

interface ReasoningStrengthSliderProps {
  capability: ReasoningCapability
  thinkingLevel: AgentThinkingLevel
  onThinkingLevelChange: (level: AgentThinkingLevel) => void
}

/** Radix 返回刻度索引；拒绝空值和越界值，不能持久化不受支持的档位。 */
export function getReasoningSliderSelection(
  levels: readonly AgentThinkingLevel[],
  position: number | undefined,
): AgentThinkingLevel | undefined {
  return position !== undefined && Number.isInteger(position) ? levels[position] : undefined
}

export function ReasoningStrengthSlider({
  capability, thinkingLevel, onThinkingLevelChange,
}: ReasoningStrengthSliderProps): React.ReactElement {
  const [previewLevel, setPreviewLevel] = React.useState<AgentThinkingLevel>()
  const savedLevel = normalizeReasoningCapabilityLevel(capability, thinkingLevel) ?? capability.defaultLevel
  const lastCommittedLevel = React.useRef(savedLevel)
  React.useEffect(() => {
    lastCommittedLevel.current = savedLevel
    setPreviewLevel(undefined)
  }, [savedLevel])
  const effectiveLevel = normalizeReasoningCapabilityLevel(capability, previewLevel ?? savedLevel)
    ?? capability.defaultLevel
  const position = Math.max(0, capability.levels.indexOf(effectiveLevel))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-foreground/80">推理强度</span>
        <span className="text-xs font-medium tabular-nums text-foreground">{THINKING_LABELS[effectiveLevel]}</span>
      </div>
      <Slider
        value={[position]}
        min={0}
        max={Math.max(1, capability.levels.length - 1)}
        step={1}
        disabled={capability.levels.length < 2}
        aria-label="推理强度"
        aria-valuetext={THINKING_LABELS[effectiveLevel]}
        onValueChange={([nextPosition]) => {
          setPreviewLevel(getReasoningSliderSelection(capability.levels, nextPosition))
        }}
        onValueCommit={([nextPosition]) => {
          const level = getReasoningSliderSelection(capability.levels, nextPosition)
          // 同一键盘事件可能在父级更新前重复提交，先记录以免重复写入会话。
          if (level && level !== lastCommittedLevel.current) {
            lastCommittedLevel.current = level
            onThinkingLevelChange(level)
          }
          setPreviewLevel(undefined)
        }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
        {capability.levels.map((level) => <span key={level}>{THINKING_LABELS[level]}</span>)}
      </div>
      <div className="flex justify-between border-t pt-2 text-[10px] text-muted-foreground">
        <span>响应更快</span>
        <span>推理更深入</span>
      </div>
    </div>
  )
}
