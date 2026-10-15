/**
 * useCreateSession — 共享的创建 Agent 会话逻辑
 *
 * 从 LeftSidebar 提取，供 WelcomeView 初始化和侧边栏共同使用。
 */

import { useAtomValue, useSetAtom } from 'jotai'
import {
  agentSessionsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useOpenSession } from './useOpenSession'

interface CreateSessionOptions {
  /** 标记为草稿会话（不在侧边栏显示，发送首条消息后自动取消） */
  draft?: boolean
  /** 是否创建后立即打开会话标签页，默认 true */
  open?: boolean
  /** 覆盖默认渠道 ID（仅 Agent 会话） */
  channelId?: string
  /** 覆盖默认模型 ID（仅 Agent 会话） */
  modelId?: string
}

interface CreateSessionActions {
  /** 创建新 Agent 会话，可选择不打开标签页 */
  createAgent: (options?: CreateSessionOptions) => Promise<string | undefined>
}

export function useCreateSession(): CreateSessionActions {
  const openSession = useOpenSession()
  const setActiveView = useSetAtom(activeViewAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  // Agent
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)

  const createAgent = async (options?: CreateSessionOptions): Promise<string | undefined> => {
    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined,
        options?.channelId ?? agentChannelId ?? undefined,
        currentWorkspaceId || undefined,
        options?.modelId ?? agentModelId ?? undefined,
        options?.draft,
      )
      setAgentSessions((prev) => [meta, ...prev])
      if (options?.open !== false) openSession('agent', meta.id, meta.title)
      if (options?.open !== false) setActiveView('conversations')
      if (options?.draft) {
        setDraftSessionIds((prev: Set<string>) => { const next = new Set(prev); next.add(meta.id); return next })
      }
      return meta.id
    } catch (error) {
      console.error('[创建会话] 创建 Agent 会话失败:', error)
      return undefined
    }
  }

  return { createAgent }
}
