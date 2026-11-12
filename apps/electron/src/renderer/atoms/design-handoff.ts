import { atom } from 'jotai'
import type { DesignHandoffResult } from '@gamma/shared'
import { agentSessionDraftHtmlAtom, agentSessionDraftsAtom, agentSessionDraftSyncVersionsAtom, agentSessionPendingFilesAtom } from './agent-atoms'
import { queuedTextToParagraphHtml } from '@/lib/agent-message-queue'

/** 只添加草稿和完整稿附件，不写 pendingPrompt，不自动启动 Agent。 */
export const addDesignHandoffToConversationAtom = atom(null, (get, set, result: DesignHandoffResult) => {
  const sessionId = result.sessionId
  const previous = get(agentSessionDraftsAtom).get(sessionId) ?? ''
  const html = get(agentSessionDraftHtmlAtom).get(sessionId) ?? ''
  const nextDraft = previous.trim() ? `${previous.trimEnd()}\n\n${result.prompt}` : result.prompt
  set(agentSessionDraftsAtom, (items) => new Map(items).set(sessionId, nextDraft))
  set(agentSessionDraftHtmlAtom, (items) => {
    const next = new Map(items)
    if (html.trim() || previous.trim()) next.set(sessionId, `${html.trim() ? html : queuedTextToParagraphHtml(previous)}${queuedTextToParagraphHtml(result.prompt)}`)
    else next.delete(sessionId)
    return next
  })
  set(agentSessionPendingFilesAtom, (items) => new Map(items).set(sessionId, [
    ...(items.get(sessionId) ?? []),
    { id: crypto.randomUUID(), filename: `${result.title}.zip`, size: result.archiveBytes, mediaType: 'application/zip', sourcePath: result.archivePath },
  ]))
  set(agentSessionDraftSyncVersionsAtom, (items) => new Map(items).set(sessionId, (items.get(sessionId) ?? 0) + 1))
})
