import { join } from 'node:path'
import type { WebContents } from 'electron'
import { GAMMA_DEFAULT_PERMISSION_MODE } from '@gamma/shared'
import type { AgentCancelQueuedMessageInput, AgentQueuedMessageControlInput, AgentSendOutboxEntry, AgentSendOutboxRetryResult } from '@gamma/shared'
import { AgentSendOutbox, readPersistedOutboxUserIds } from './agent-send-outbox'
import { AgentSendOutboxRecovery } from './agent-send-outbox-recovery'
import { prepareOutboxRetryInput } from './agent-send-outbox-retry-policy'
import { AgentMessageSubmissionGate } from './agent-message-submission-gate'
import { getAgentSessionMeta, isAgentSessionDeleting } from './agent-session-manager'
import { getAgentWorkspace, getProjectFilesPath, getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles } from './agent-workspace-manager'
import { getAgentSessionWorkspacePath, getAgentSessionMessagesPath } from './config-paths'
import { isAgentSessionBusy, isAgentMessageQueuedOrDispatching, listQueuedAgentMessages, submitOrEnqueueAgentMessage, cancelAgentQueuedMessage } from './agent-service'

function resolveOutboxContext(sessionId: string) {
  const session = getAgentSessionMeta(sessionId)
  if (!session || isAgentSessionDeleting(sessionId)) throw new Error('会话不存在或正在删除')
  const workspace = session.workspaceId ? getAgentWorkspace(session.workspaceId) : undefined
  if (!workspace) throw new Error('会话没有可用的工作区，无法安全暂存消息')
  return { session, workspace, workbench: getAgentSessionWorkspacePath(workspace.slug, sessionId) }
}
const outbox = new AgentSendOutbox((sessionId) => join(resolveOutboxContext(sessionId).workbench, '.gamma-send-outbox.json'))
const submissionGate = new AgentMessageSubmissionGate({
  isPersisted: (sessionId, messageId) => {
    resolveOutboxContext(sessionId)
    return readPersistedOutboxUserIds(getAgentSessionMessagesPath(sessionId)).has(messageId)
  },
  isQueued: isAgentMessageQueuedOrDispatching,
})
export const submitAgentMessageOnce = <T>(sessionId: string, messageId: string | undefined, operation: () => Promise<T>) => submissionGate.submit(sessionId, messageId, operation)

const recovery = new AgentSendOutboxRecovery({
  outbox,
  readAcceptedIds: (sessionId) => readPersistedOutboxUserIds(getAgentSessionMessagesPath(sessionId)),
  queuedIds: (sessionId) => new Set(listQueuedAgentMessages(sessionId).map(({ input }) => input.queueMessageId)),
  isBusy: isAgentSessionBusy,
  prepareRetryInput: (entry) => {
    const { session, workspace, workbench } = resolveOutboxContext(entry.sessionId)
    return prepareOutboxRetryInput(entry, {
      workspaceId: workspace.id,
      permissionMode: session.permissionMode ?? GAMMA_DEFAULT_PERMISSION_MODE,
      directories: [workbench, getProjectFilesPath(workspace.slug), ...(session.activeWorktree?.path ? [session.activeWorktree.path] : []), ...(session.attachedDirectories ?? []), ...getWorkspaceAttachedDirectories(workspace.slug)],
      files: [...(session.attachedFiles ?? []), ...getWorkspaceAttachedFiles(workspace.slug)],
    })
  },
})

export function listAgentSendOutbox(sessionId: string): AgentSendOutboxEntry[] { return recovery.list(sessionId) }
export function saveAgentSendOutbox(entry: AgentSendOutboxEntry): void { recovery.save(entry) }
export function cancelQueuedAgentSend(input: AgentCancelQueuedMessageInput): boolean {
  return recovery.cancelQueued(input, () => cancelAgentQueuedMessage(input))
}
export function retryAgentSendOutbox(input: AgentQueuedMessageControlInput, target: WebContents): Promise<AgentSendOutboxRetryResult> {
  return recovery.retry(input, async (retryInput) => {
    const result = await submitAgentMessageOnce(input.sessionId, input.messageId, () => submitOrEnqueueAgentMessage(retryInput, target))
    return result.duplicate ? { disposition: result.acceptedAs === 'queued' ? 'queued' : 'accepted' } : result.value
  })
}
