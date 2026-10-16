import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentSendOutboxEntry } from '@gamma/shared'
import { AgentSendOutbox } from './agent-send-outbox'
import { AgentSendOutboxRecovery } from './agent-send-outbox-recovery'
import { prepareOutboxRetryInput } from './agent-send-outbox-retry-policy'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gamma-outbox-retry-')); roots.push(dir)
  const entry: AgentSendOutboxEntry = {
    sessionId: 'session', id: 'message', createdAt: 1, status: 'failed',
    draft: { text: '旧正文', html: '<p>旧正文</p>', attachments: [] },
    input: { sessionId: 'session', queueMessageId: 'message', userMessageUuid: 'message', userMessage: '旧正文', channelId: 'channel', dispatch: 'now', permissionModeOverride: 'bypassPermissions', additionalDirectories: ['/revoked'] },
  }
  const outbox = new AgentSendOutbox((id) => join(dir, `${id}.json`)); outbox.save(entry)
  const accepted = new Set<string>(), queued = new Set<string>()
  const state = { busy: false, brokenHistory: false }
  const recovery = new AgentSendOutboxRecovery({
    outbox,
    readAcceptedIds: () => { if (state.brokenHistory) throw new Error('历史不可读'); return accepted },
    queuedIds: () => queued, isBusy: () => state.busy,
    prepareRetryInput: (item) => prepareOutboxRetryInput(item, { workspaceId: 'workspace', permissionMode: 'plan', directories: [dir], files: [] }),
  })
  return { dir, entry, outbox, accepted, queued, state, recovery, control: { sessionId: 'session', messageId: 'message' } }
}

describe('Given 主进程恢复协调器', () => {
  test('When 并发重试同一ID Then 共用一个在途提交并采用当前较严格权限', async () => {
    const f = fixture(); let calls = 0
    const submit = async (input: AgentSendOutboxEntry['input']) => {
      ++calls; expect(input.permissionModeOverride).toBe('plan'); expect(input.additionalDirectories).toEqual([])
      expect(input.userMessage).toBe('旧正文'); expect(input.userMessageUuid).toBe('message')
      await Bun.sleep(5); f.accepted.add('message'); return { disposition: 'started' as const }
    }
    const first = f.recovery.retry(f.control, submit), second = f.recovery.retry(f.control, submit)
    expect(first).toBe(second); await Promise.all([first, second])
    expect(calls).toBe(1); expect(f.outbox.list('session')).toEqual([])
  })
  test('When 消息已写入历史或仍在队列 Then 不再调用提交', async () => {
    const f = fixture(); let calls = 0
    const submit = async () => { ++calls; return { disposition: 'started' as const } }
    f.queued.add('message'); expect(await f.recovery.retry(f.control, submit)).toEqual({ disposition: 'queued' })
    f.queued.clear(); f.accepted.add('message')
    expect(await f.recovery.retry(f.control, submit)).toEqual({ disposition: 'accepted' }); expect(calls).toBe(0)
  })
  test('When 历史不可读 Then 失败关闭且日志不删除、模型不执行', async () => {
    const f = fixture(); f.state.brokenHistory = true; let called = false
    await expect(f.recovery.retry(f.control, async () => { called = true; return { disposition: 'started' } })).rejects.toThrow('历史不可读')
    expect(called).toBe(false); expect(f.outbox.list('session')).toHaveLength(1)
  })
  test('When 会话运行中 Then 阻止不确定的重复提交；失败仍可重试', async () => {
    const f = fixture(); f.state.busy = true
    await expect(f.recovery.retry(f.control, async () => ({ disposition: 'started' }))).rejects.toThrow('仍在运行')
    f.state.busy = false
    await expect(f.recovery.retry(f.control, async () => { throw new Error('离线') })).rejects.toThrow('离线')
    expect(f.outbox.list('session')[0]?.status).toBe('failed')
    expect(await f.recovery.retry(f.control, async () => ({ disposition: 'queued' }))).toEqual({ disposition: 'queued' })
    expect(f.outbox.list('session')).toHaveLength(1)
  })
  test('When 迟到失败回调试图写回已确认消息 Then 不复活旧日志', () => {
    const f = fixture(); f.accepted.add('message'); f.recovery.save(f.entry)
    expect(f.outbox.list('session')).toEqual([])
  })
  test('When 附件被删除、撤销授权或符号链接越界 Then 不恢复旧授权', () => {
    const f = fixture(); const allowed = join(f.dir, 'allowed'), external = join(f.dir, 'external')
    mkdirSync(allowed); mkdirSync(external); writeFileSync(join(external, 'file'), 'test'); symlinkSync(external, join(allowed, 'link'))
    const withFile = { ...f.entry, draft: { ...f.entry.draft, attachments: [{ filename: '附件', size: 4, mediaType: 'text/plain', targetPath: join(allowed, 'link/file') }] } }
    const context = { workspaceId: 'workspace', permissionMode: 'plan' as const, directories: [allowed], files: [] }
    expect(() => prepareOutboxRetryInput(withFile, context)).toThrow('授权已变更')
    expect(() => prepareOutboxRetryInput({ ...withFile, draft: { ...withFile.draft, attachments: [{ ...withFile.draft.attachments[0]!, targetPath: join(allowed, 'missing') }] } }, context)).toThrow('已不存在')
    expect(prepareOutboxRetryInput(withFile, { ...context, files: [join(external, 'file')] }).permissionModeOverride).toBe('plan')
    expect(() => prepareOutboxRetryInput({ ...f.entry, input: { ...f.entry.input, workspaceId: 'old' } }, context)).toThrow('已迁移')
  })
})
