export type ComputerValidationFailureReason =
  | 'not-active-run' | 'non-foreground' | 'run-paused' | 'consent-revoked'
  | 'lease-missing' | 'ipc-error' | 'unknown'

interface ComputerValidationFailure {
  reason: ComputerValidationFailureReason
  errorName?: string
  messageLength?: number
}

// 必须与电脑控制器和 Utility RPC 的固定错误文案精确匹配；不得写入异常原文。
const FIXED_FAILURES: Readonly<Record<string, Exclude<ComputerValidationFailureReason, 'unknown'>>> = {
  '电脑工具不属于当前有效运行': 'not-active-run',
  '电脑操作只允许前台用户运行': 'non-foreground',
  '本轮电脑操作已暂停；请发送新任务或说“继续”，不会重放旧动作': 'run-paused',
  '截图外发同意已撤销': 'consent-revoked',
  '缺少电脑外发核验': 'lease-missing',
  'Agent runtime is shutting down': 'ipc-error',
  'Agent runtime port is not connected': 'ipc-error',
  'Main runtime request timed out: agent.capability.computerValidate': 'ipc-error',
  'Main runtime request aborted: agent.capability.computerValidate': 'ipc-error',
  'Main request failed: agent.capability.computerValidate': 'ipc-error',
}

export function classifyComputerValidationFailure(error: unknown): ComputerValidationFailure {
  try {
    const message = error instanceof Error ? error.message : undefined
    if (message && Object.hasOwn(FIXED_FAILURES, message)) return { reason: FIXED_FAILURES[message]! }
    return {
      reason: 'unknown',
      ...(error instanceof Error ? { errorName: error.name, messageLength: error.message.length } : {}),
    }
  } catch {
    // 异常对象可能有抛错的访问器；分类失败也不能干扰观察内容剥离。
    return { reason: 'unknown' }
  }
}
