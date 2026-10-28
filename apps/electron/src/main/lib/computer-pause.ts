export const COMPUTER_RUN_PAUSED_MESSAGE = '本轮电脑操作已暂停；请发送新任务或说“继续”，不会重放旧动作'

/** code/details 由现有 Utility RPC 错误契约原样传递，message 保持固定以便精确归类。 */
export class ComputerRunPausedError extends Error {
  readonly code = 'computer.run-paused'
  readonly details: { stopReason: string }
  constructor(reason: string) {
    super(COMPUTER_RUN_PAUSED_MESSAGE)
    this.name = 'ComputerRunPausedError'
    this.details = { stopReason: reason }
  }
}

export function getComputerPauseReason(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'computer.run-paused'
    || !('details' in error) || !error.details || typeof error.details !== 'object' || !('stopReason' in error.details)) return undefined
  return typeof error.details.stopReason === 'string' ? error.details.stopReason : undefined
}

export function computerPausedToolMessage(reason = '未提供停止原因'): string {
  return `本轮电脑操作已暂停（原因：${reason}）。不要再调用 computer 工具；请向用户说明情况并等待新的消息。`
}

/** 仅识别门禁生成的完整协议文案，不把任意工具拒绝当成电脑安全暂停。 */
export function getComputerPausedToolReason(message: string): string | undefined {
  const prefix = '本轮电脑操作已暂停（原因：'
  const suffix = '）。不要再调用 computer 工具；请向用户说明情况并等待新的消息。'
  return message.startsWith(prefix) && message.endsWith(suffix) && message.length > prefix.length + suffix.length
    ? message.slice(prefix.length, -suffix.length) : undefined
}
