/**
 * WelcomeEmptyState — 对话/会话空状态
 *
 * 在没有会话时展示：
 * 1. 个性化时段问候
 * 2. Agent 欢迎状态
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { userProfileAtom } from '@/atoms/user-profile'

/** 根据小时返回时段问候 */
function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function WelcomeEmptyState(): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)

  const hour = new Date().getHours()
  const greeting = getGreeting(hour)
  const displayName = userProfile.userName || '用户'

  return (
    <div className="welcome-empty-state flex h-full flex-col items-center justify-center gap-6 px-4">
      {/* 问候语 */}
      <h1 className="max-w-xl break-words text-center text-3xl font-medium tracking-tight text-foreground">
        {displayName}，{greeting}
      </h1>

    </div>
  )
}
