import type * as React from 'react'

export interface ComputerUseStatusProps {
  sessionId?: string | null
}

/**
 * 桌面操作状态与停止入口：
 * 停止按钮已统一使用系统级原生 NSPanel（位于屏幕右上角、菜单栏下方），
 * 运行状态仅在聊天记录的 computer 工具卡片中展示，应用内不再放置悬浮卡片。
 */
export function ComputerUseStatus(_props: ComputerUseStatusProps): React.ReactElement | null {
  return null
}
