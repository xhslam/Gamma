import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { appendFileSync, mkdirSync } from 'node:fs'

export interface ComputerLogEntry {
  time: string
  source?: string
  event?: string
  sessionId?: string | null
  runId?: string | null
  action?: string | null
  rawError?: string | null
  errorCode?: string | null
  outcome?: string | null
  reason?: string | null
  errorMessage?: string | null
  errorStack?: string | null
  [key: string]: unknown
}

let mainLogPath: string | undefined

/** 仅主进程初始化；Utility 使用启动时显式传入的路径。 */
export function configureComputerLogPath(path: string): void {
  mainLogPath = path
}

export function getComputerLogPath(): string {
  return mainLogPath || process.env.GAMMA_COMPUTER_LOG_PATH || join(homedir(), 'Library', 'Logs', 'Gamma', 'computer-use.log')
}

export function logComputerUseEvent(entry: ComputerLogEntry): void {
  try {
    const line = JSON.stringify(entry)
    const logPath = getComputerLogPath()
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, line + '\n', 'utf8')
    console.log('[computer-use-log]', line)
  } catch {
    // 日志是尽力而为：序列化、路径、文件和控制台失败都不能改变业务行为。
  }
}
