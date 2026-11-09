import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { IntelligentUiAction } from './intelligent-ui-policy'

export interface IntelligentUiSession {
  workspaceId: string
  sessionId: string
  canSend: boolean
  sendAction: (blockId: string, event: IntelligentUiAction) => Promise<void>
}
const SessionContext = createContext<IntelligentUiSession | null>(null)
export const useIntelligentUiSession = () => useContext(SessionContext)
export function IntelligentUiSessionProvider({ value, children }: { value: IntelligentUiSession; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export interface IntelligentUiMessage {
  blockId: string
  isStreaming: boolean
  markdown: string
}
export const IntelligentUiMessageContext = createContext<IntelligentUiMessage | null>(null)
