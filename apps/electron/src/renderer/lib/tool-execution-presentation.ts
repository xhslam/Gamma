/** 仅由真实结果/审批状态推导展示；授权成功不是工具成功，缺失结果也不是取消。 */
export type ToolExecutionStatus = 'pending' | 'approval-submitting' | 'running' | 'success' | 'error' | 'denied' | 'cancelled' | 'unknown'

export interface ToolExecutionEvidence {
  /** 必须按工具调用 ID 关联；不能仅凭工具名关联并发请求。 */
  approval?: 'pending' | 'submitting'
  result?: { result?: string; isError?: boolean } | null
  isStreaming?: boolean
}

export interface ToolExecutionPresentation {
  status: ToolExecutionStatus
  label: string
  tone: 'muted' | 'active' | 'success' | 'error'
}

export function getToolExecutionPresentation(evidence: ToolExecutionEvidence): ToolExecutionPresentation {
  if (evidence.result != null) {
    if (!evidence.result.isError) return { status: 'success', label: '已完成', tone: 'success' }
    // 当前 permission service 的精确错误哨兵；不把工具任意输出中的“拒绝/取消”字样当事实。
    const message = evidence.result.result?.trim().replace(/^Error: /, '')
    if (message === '用户拒绝了此操作') return { status: 'denied', label: '已拒绝', tone: 'muted' }
    if (message === '操作已中止') return { status: 'cancelled', label: '已取消', tone: 'muted' }
    return { status: 'error', label: '执行失败', tone: 'error' }
  }
  if (evidence.approval === 'submitting') return { status: 'approval-submitting', label: '正在提交审批', tone: 'active' }
  if (evidence.approval === 'pending') return { status: 'pending', label: '等待审批', tone: 'muted' }
  if (evidence.isStreaming) return { status: 'running', label: '正在执行', tone: 'active' }
  return { status: 'unknown', label: '未收到执行结果', tone: 'muted' }
}
