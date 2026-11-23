import * as React from 'react'
import { atom, useAtomValue } from 'jotai'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'

export function useImageCommentAvailability(sessionId: string | undefined): boolean {
  const targetAtom = React.useMemo(() => atom((get) => {
    if (!sessionId) return null
    const session = get(agentSessionsAtom).find((item) => item.id === sessionId)
    const channelId = session?.channelId ?? get(agentSessionChannelMapAtom).get(sessionId) ?? get(agentChannelIdAtom)
    const modelId = session?.modelId ?? get(agentSessionModelMapAtom).get(sessionId) ?? get(agentModelIdAtom)
    return { channelId, modelId }
  }), [sessionId])
  const selection = useAtomValue(targetAtom)
  const channelId = selection?.channelId
  const modelId = selection?.modelId
  const [supported, setSupported] = React.useState<{ channelId: string; modelId: string } | null>(null)

  React.useEffect(() => {
    setSupported(null)
    if (!channelId || !modelId) return
    let cancelled = false
    void window.electronAPI.getPiImageInputSupport?.(channelId, modelId).then((available) => {
      if (!cancelled && available) setSupported({ channelId, modelId })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [channelId, modelId])

  return Boolean(supported && supported.channelId === channelId && supported.modelId === modelId)
}
