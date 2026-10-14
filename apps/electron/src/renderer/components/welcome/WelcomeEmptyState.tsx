/**
 * WelcomeEmptyState — 对话/会话空状态
 *
 * 在没有会话时展示：
 * 1. 个性化时段问候
 * 2. Chat/Agent 模式切换
 */

import * as React from 'react'
import { useAtomValue, useAtom } from 'jotai'
import { MessageSquare, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { userProfileAtom } from '@/atoms/user-profile'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'

/** 根据小时返回时段问候 */
function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 模式配置 */
const MODE_CONFIG: Record<AppMode, { icon: React.ReactNode; label: string }> = {
  chat: { icon: <MessageSquare size={15} />, label: 'Chat' },
  agent: { icon: <Bot size={15} />, label: 'Agent' },
}

export function WelcomeEmptyState(): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const [mode, setMode] = useAtom(appModeAtom)

  const hour = new Date().getHours()
  const greeting = getGreeting(hour)
  const displayName = userProfile.userName || '用户'

  /** 切换模式：仅切换模式，不创建新会话 */
  const handleModeSwitch = React.useCallback((targetMode: AppMode): void => {
    if (targetMode === mode) return
    setMode(targetMode)
  }, [mode, setMode])

  return (
    <div className="welcome-empty-state flex h-full flex-col items-center justify-center gap-6 px-4">
      {/* 问候语 */}
      <h1 className="max-w-xl break-words text-center text-3xl font-medium tracking-tight text-foreground">
        {displayName}，{greeting}
      </h1>

      {/* 空状态只呈现模式选择，不附加推广和随机操作引导。 */}
      <div role="group" aria-label="选择工作模式" className="flex items-center gap-2">
        {(['agent', 'chat'] as const).map((m) => {
          const config = MODE_CONFIG[m]
          const isSelected = mode === m
          return (
            <button
              key={m}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleModeSwitch(m)}
              className={cn(
                'gamma-mode-button flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors duration-150',
                isSelected
                  ? 'bg-foreground/[0.07] font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
              )}
            >
              {config.icon}
              {config.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
