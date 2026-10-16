import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { GAMMA_PERMISSION_MODES } from '@gamma/shared'
import type { AgentSendOutboxEntry, AgentSubmitOrEnqueueInput } from '@gamma/shared'
import { writeTextFileAtomic } from './safe-file'

const MAX_OUTBOX_BYTES = 16 * 1024 * 1024
const MAX_OUTBOX_ENTRIES = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 不信任 IPC 或磁盘内容；持久化只允许公开发送参数，绝不透传内部 runGeneration。 */
export function parseSendOutboxEntry(value: unknown, sessionId: string): AgentSendOutboxEntry {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.id !== 'string'
    || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt) || (value.status !== 'pending' && value.status !== 'failed')
    || !isRecord(value.draft) || typeof value.draft.text !== 'string' || typeof value.draft.html !== 'string'
    || !Array.isArray(value.draft.attachments) || !isRecord(value.input)) {
    throw new Error('失败消息快照格式无效')
  }
  const input = value.input
  if (input.sessionId !== sessionId || input.queueMessageId !== value.id || input.userMessageUuid !== value.id
    || typeof input.userMessage !== 'string' || !input.userMessage.trim()
    || typeof input.channelId !== 'string' || !input.channelId
    || (input.dispatch !== 'now' && input.dispatch !== 'after_current')) throw new Error('失败消息发送参数无效')
  const attachments = value.draft.attachments.map((file: unknown) => {
    if (!isRecord(file) || typeof file.filename !== 'string' || typeof file.mediaType !== 'string'
      || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0
      || typeof file.targetPath !== 'string' || !isAbsolute(file.targetPath)) throw new Error('失败消息附件无效')
    return { filename: file.filename, mediaType: file.mediaType, size: file.size, targetPath: file.targetPath }
  })
  const safeInput: AgentSubmitOrEnqueueInput = {
    sessionId, queueMessageId: value.id, userMessageUuid: value.id,
    channelId: input.channelId, userMessage: input.userMessage, dispatch: input.dispatch,
  }
  for (const key of ['rawUserMessage', 'modelId', 'workspaceId'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new Error('失败消息参数类型无效')
      safeInput[key] = input[key]
    }
  }
  for (const key of ['additionalDirectories', 'mentionedSkills', 'mentionedMcpServers', 'mentionedSessionIds', 'mentionedTodoIds', 'mentionedCalendarEventIds'] as const) {
    const items = input[key]
    if (items !== undefined) {
      if (!Array.isArray(items) || !items.every((item: unknown) => typeof item === 'string')) throw new Error('失败消息引用无效')
      safeInput[key] = items as string[]
    }
  }
  if (input.permissionModeOverride !== undefined) {
    if (!GAMMA_PERMISSION_MODES.some((mode) => mode === input.permissionModeOverride)) throw new Error('失败消息权限模式无效')
    safeInput.permissionModeOverride = input.permissionModeOverride as AgentSubmitOrEnqueueInput['permissionModeOverride']
  }
  if (typeof input.startedAt === 'number' && Number.isFinite(input.startedAt)) safeInput.startedAt = input.startedAt
  return {
    id: value.id, sessionId, createdAt: value.createdAt, status: value.status,
    ...(typeof value.error === 'string' && { error: value.error.slice(0, 2000) }),
    draft: { text: value.draft.text, html: value.draft.html, attachments }, input: safeInput,
  }
}

interface OutboxDocument {
  version: 1
  entries: AgentSendOutboxEntry[]
}

/** 同一主进程内同步读改写，safe-file 的随机临时文件 + fsync + rename 保证原子替换。 */
export class AgentSendOutbox {
  constructor(private readonly resolvePath: (sessionId: string) => string) {}

  list(sessionId: string): AgentSendOutboxEntry[] {
    const path = this.resolvePath(sessionId)
    if (!existsSync(path)) return []
    const raw = readFileSync(path, 'utf8')
    if (Buffer.byteLength(raw) > MAX_OUTBOX_BYTES) throw new Error('失败消息文件超过大小限制')
    const document: unknown = JSON.parse(raw)
    if (!isRecord(document) || document.version !== 1 || !Array.isArray(document.entries)) throw new Error('失败消息文件损坏，已保留原文件')
    return document.entries.map((entry: unknown) => parseSendOutboxEntry(entry, sessionId))
  }

  save(value: AgentSendOutboxEntry): void {
    const entry = parseSendOutboxEntry(value, value.sessionId)
    const entries = this.list(entry.sessionId)
    const index = entries.findIndex((item) => item.id === entry.id)
    if (index < 0) entries.push(entry)
    else entries[index] = entry
    if (entries.length > MAX_OUTBOX_ENTRIES) throw new Error('待恢复消息已达100条，请先处理已有消息')
    this.write(entry.sessionId, entries)
  }

  /** 仅有持久化用户消息的 UUID 证据时调用，不能凭网络响应或启动事件删除日志。 */
  acknowledge(sessionId: string, acceptedIds: ReadonlySet<string>): void {
    const entries = this.list(sessionId)
    const remaining = entries.filter((entry) => !acceptedIds.has(entry.id))
    if (remaining.length !== entries.length) this.write(sessionId, remaining)
  }

  private write(sessionId: string, entries: AgentSendOutboxEntry[]): void {
    const document: OutboxDocument = { version: 1, entries }
    const json = JSON.stringify(document)
    if (Buffer.byteLength(json) > MAX_OUTBOX_BYTES) throw new Error('失败消息快照超过大小限制，原草稿未提交')
    writeTextFileAtomic(this.resolvePath(sessionId), json)
  }
}

/** 去重读取必须失败关闭；展示历史的宽松解析不能用作再次执行的证据。 */
export function readPersistedOutboxUserIds(path: string): Set<string> {
  let raw: string
  try { raw = readFileSync(path, 'utf8') } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return new Set()
    throw new Error('无法验证消息历史，已暂停重试，请检查会话文件', { cause: error })
  }
  const ids = new Set<string>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: unknown
    try { record = JSON.parse(line) } catch (error) {
      throw new Error('消息历史含损坏记录，已暂停重试，原暂存消息保留', { cause: error })
    }
    if (!isRecord(record) || (typeof record.type !== 'string' && typeof record.role !== 'string')) throw new Error('消息历史格式异常，已暂停重试')
    if (record.type === 'user' && typeof record.uuid === 'string') ids.add(record.uuid)
  }
  return ids
}
