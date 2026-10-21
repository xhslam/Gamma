import type { AgyActivityEvent } from '@gamma/shared'

/** 仅合并相邻、同一步骤的文本行；工具和异常事件保留原有顺序与详情。 */
export function groupAgyActivity(events: readonly AgyActivityEvent[]): AgyActivityEvent[] {
  const grouped: AgyActivityEvent[] = []
  for (const event of events) {
    const previous = grouped.at(-1)
    if (event.kind === 'text' && event.details === undefined && !event.toolName) {
      if (previous?.kind === 'text' && previous.details === undefined && !previous.toolName && previous.stepIndex === event.stepIndex) {
        grouped[grouped.length - 1] = { ...previous, text: (previous.text ?? '') + (event.text ?? ''), state: event.state ?? previous.state }
        continue
      }
      if (!event.text?.trim()) continue
    }
    grouped.push({ ...event })
  }
  return grouped
}

export function formatAgyDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined
  return seconds < 60 ? `${Number(seconds.toFixed(1))}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

export function agyEventStateLabel(state: string): string {
  const labels: Record<string, string> = {
    ACTIVE: '执行中', RUNNING: '执行中', PENDING: '等待中', DONE: '已结束',
    COMPLETED: '已结束', SUCCESS: '已结束', ERROR: '出错', FAILED: '出错',
    CANCELLED: '已取消', CANCELED: '已取消',
  }
  return labels[state.toUpperCase()] ?? state
}
