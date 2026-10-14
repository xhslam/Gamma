/**
 * ModeSwitcher - Chat/Agent 工作模式切换
 *
 * 切换模式时自动恢复上一次在该模式下查看的对话/会话：
 * 1. 优先恢复上次选中的对话 ID
 * 2. 其次查找已打开的同类型 Tab
 * 3. 兜底打开最近的对话/会话（列表首项）
 * 4. 都没有则仅切换模式
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { tabsAtom } from '@/atoms/tab-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { Bot, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

const modes: { value: AppMode; label: string; icon: React.ReactNode }[] = [
  { value: 'agent', label: 'Agent', icon: <Bot size={15} /> },
  { value: 'chat', label: 'Chat', icon: <MessageSquare size={15} /> },
]

export function ModeSwitcher(): React.ReactElement {
  const [mode, setMode] = useAtom(appModeAtom)
  const openSession = useOpenSession()
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const tabs = useAtomValue(tabsAtom)

  /** 尝试恢复目标模式下的上一个对话/会话，按优先级 fallback */
  const restoreSession = React.useCallback((targetMode: AppMode) => {
    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? conversations : agentSessions
    const lastId = isChatMode ? currentConversationId : currentAgentSessionId

    // 1. 上次选中的对话仍存在 → 恢复
    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) {
        openSession(targetMode, match.id, match.title)
        return
      }
    }
    // 2. 已打开的同类型 Tab → 聚焦
    const tab = tabs.find((t) => t.type === targetMode)
    if (tab) {
      openSession(targetMode, tab.sessionId, tab.title)
      return
    }
    // 3. 最近的未归档对话/会话 → 打开
    const recent = sessions.find((s) => !s.archived)
    if (recent) {
      openSession(targetMode, recent.id, recent.title)
      return
    }
    // 4. 无任何对话，仅切换模式
    setMode(targetMode)
  }, [openSession, conversations, agentSessions, currentConversationId, currentAgentSessionId, tabs, setMode])

  const handleModeSwitch = React.useCallback((targetMode: AppMode) => {
    if (targetMode === mode) return
    restoreSession(targetMode)
  }, [mode, restoreSession])

  return (
    <div className="select-none titlebar-no-drag">
      <div role="group" aria-label="工作模式" className="flex items-center">
        {modes.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => handleModeSwitch(value)}
            className={cn(
              'gamma-mode-button relative flex h-9 items-center gap-2 px-3 text-[13px] transition-colors duration-150',
              mode === value
                ? 'font-medium text-foreground'
                : 'text-foreground/45 hover:text-foreground/70'
            )}
          >
            {icon}
            {label}
            {/* CoWork 式底部选中指示线 */}
            {mode === value && (
              <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-foreground/80" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
