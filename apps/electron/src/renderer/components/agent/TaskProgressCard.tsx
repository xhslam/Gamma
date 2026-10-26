import * as React from 'react'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { aggregateTaskItems } from './task-progress'
import type { TaskItem, TaskItemStatus } from './task-progress'
import { getProcessErrorSummary } from './process-timeline-presentation'
import { FadeTitle } from '@/components/ui/fade-title'
import './process-timeline.css'

type PlanStatus = TaskItemStatus | 'approval'

const STATUS_LABELS: Record<PlanStatus, string> = {
  pending: '未开始', in_progress: '进行中', completed: '已完成', blocked: '受阻',
  cancelled: '已取消', error: '失败', deleted: '已删除', approval: '等待审批',
}

/** 状态图形在同一个 16px 槽位交叉淡变，不额外添加图标列或圆形底座。 */
function PlanCircle({ status }: { status: PlanStatus }): React.ReactElement {
  const completed = status === 'completed'
  const error = status === 'error'
  const waiting = status === 'approval' || status === 'blocked'
  const pending = status === 'pending' || status === 'cancelled'
  return (
    <svg className="process-plan-circle" viewBox="0 0 16 16" role="img" aria-label={STATUS_LABELS[status]}>
      <circle className="process-plan-shape" data-active={pending} cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <circle className="process-plan-shape" data-active={status === 'in_progress'} cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle className="process-plan-shape process-plan-amber" data-active={waiting} cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <g className="process-plan-shape process-plan-done" data-active={completed}>
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path className="process-plan-check" d="m4.5 8 2.25 2.25 4.75-4.5" pathLength="1" fill="none" stroke="hsl(var(--primary-foreground))" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="process-plan-shape process-plan-failed" data-active={error}>
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path d="m5.5 5.5 5 5m0-5-5 5" fill="none" stroke="hsl(var(--primary-foreground))" strokeWidth="1.25" strokeLinecap="round" />
      </g>
    </svg>
  )
}

function TaskRow({ item, approvalPending }: { item: TaskItem; approvalPending: boolean }): React.ReactElement {
  const status: PlanStatus = approvalPending && item.status === 'in_progress' ? 'approval' : item.status
  const errorSummary = item.status === 'error' ? getProcessErrorSummary(item.description) ?? '未提供错误详情' : undefined
  return (
    <div data-plan-row="" data-plan-status={status} className="process-plan-item">
      <div className="process-plan-row">
        <PlanCircle status={status} />
        <FadeTitle className="process-plan-subject" title={item.subject}>{item.subject}</FadeTitle>
      </div>
      {errorSummary && <div data-plan-error="" className="process-plan-error" title={errorSummary}>{errorSummary}</div>}
    </div>
  )
}

interface TaskProgressCardProps {
  activities: ToolActivity[]
  streamEnded?: boolean
  historicalTaskSubjects?: Map<string, string>
  approvalPending?: boolean
}

/** 计划只显示确认后的阶段与状态，不将实时 activeForm 替换成计划标题。 */
export function TaskProgressCard({ activities, streamEnded = false, historicalTaskSubjects, approvalPending = false }: TaskProgressCardProps): React.ReactElement | null {
  const items = React.useMemo(
    () => aggregateTaskItems(activities, streamEnded, historicalTaskSubjects),
    [activities, streamEnded, historicalTaskSubjects],
  )
  if (items.length === 0) return null
  const approvalTaskId = approvalPending ? items.findLast((item) => item.status === 'in_progress')?.id : undefined
  return (
    <div data-process-plan="" className="process-plan-card">
      {items.map((item) => <TaskRow key={item.id} item={item} approvalPending={item.id === approvalTaskId} />)}
    </div>
  )
}
