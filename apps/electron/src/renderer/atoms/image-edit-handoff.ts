import { atom } from 'jotai'
import { agentSessionDraftHtmlAtom, agentSessionDraftSyncVersionsAtom, agentSessionDraftsAtom } from './agent-atoms'
import { queuedTextToParagraphHtml } from '@/lib/agent-message-queue'

export interface ImageEditDraftHandoff {
  sessionId: string
  prompt: string
}

/** 将图片编辑要求追加到当前会话草稿；不覆盖已有内容，也不自动启动 Agent。 */
export const appendImageEditPromptAtom = atom(null, (get, set, handoff: ImageEditDraftHandoff) => {
  const prompt = handoff.prompt.trim()
  if (!handoff.sessionId || !prompt) return
  const previous = get(agentSessionDraftsAtom).get(handoff.sessionId) ?? ''
  const html = get(agentSessionDraftHtmlAtom).get(handoff.sessionId) ?? ''
  const nextDraft = previous.trim() ? `${previous.trimEnd()}\n\n${prompt}` : prompt
  set(agentSessionDraftsAtom, (items) => new Map(items).set(handoff.sessionId, nextDraft))
  set(agentSessionDraftHtmlAtom, (items) => {
    const next = new Map(items)
    const previousHtml = html.trim() ? html : queuedTextToParagraphHtml(previous)
    next.set(handoff.sessionId, `${previousHtml}${queuedTextToParagraphHtml(prompt)}`)
    return next
  })
  set(agentSessionDraftSyncVersionsAtom, (items) => new Map(items).set(handoff.sessionId, (items.get(handoff.sessionId) ?? 0) + 1))
})
