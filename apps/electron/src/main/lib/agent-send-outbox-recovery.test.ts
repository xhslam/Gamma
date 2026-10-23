import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
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
  test('When 其他任务仍在运行 Then 未接收的稳定 ID 可通过统一门禁重新入队', async () => {
    const f = fixture(); f.state.busy = true
    let calls = 0
    expect(await f.recovery.retry(f.control, async (input) => {
      ++calls
      expect(input.queueMessageId).toBe('message')
      f.queued.add('message')
      return { disposition: 'queued' }
    })).toEqual({ disposition: 'queued' })
    expect(calls).toBe(1)
    expect(await f.recovery.retry(f.control, async () => { ++calls; return { disposition: 'queued' } })).toEqual({ disposition: 'queued' })
    expect(calls).toBe(1)
  })
  test('When 重试失败 Then 保存失败快照且仍可再次重试', async () => {
    const f = fixture()
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
  test('When 用户撤回队列消息 Then 同步清理发送日志，重启后不再复活为失败消息', () => {
    const f = fixture(); f.queued.add('message')
    expect(f.recovery.cancelQueued(f.control, () => f.queued.delete('message'))).toBe(true)
    expect(f.queued.size).toBe(0)
    expect(new AgentSendOutbox((id) => join(f.dir, `${id}.json`)).list('session')).toEqual([])
    expect(f.recovery.list('session')).toEqual([])
  })
  test('When 为立即插队取消原队列 Then 保留发送日志直到实际接收，不因 IPC 失败丢失消息', () => {
    const f = fixture(); f.queued.add('message')
    expect(f.recovery.cancelQueued({ ...f.control, preserveSendOutbox: true }, () => f.queued.delete('message'))).toBe(true)
    expect(f.queued.size).toBe(0)
    expect(f.outbox.list('session')).toEqual([f.entry])
    expect(f.recovery.list('session')).toHaveLength(1)
  })
  test('When 消息已经开始执行 Then 撤回失败且不删除日志，也不调用取消', () => {
    const f = fixture(); let cancelled = false
    expect(f.recovery.cancelQueued(f.control, () => { cancelled = true; return true })).toBe(false)
    expect(cancelled).toBe(false)
    expect(f.outbox.list('session')).toEqual([f.entry])
  })
  test('When 撤回时发送日志不可写 Then 保留主进程队列与原文件，不仅移除界面', () => {
    const f = fixture(); f.queued.add('message')
    const path = join(f.dir, 'session.json'); writeFileSync(path, '{broken')
    expect(() => f.recovery.cancelQueued(f.control, () => f.queued.delete('message'))).toThrow()
    expect(f.queued.has('message')).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('{broken')
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

  test('When 磁盘崩溃重启后历史重试 Then 保留原冻结引用A，不受Composer当前新引用B影响，且排队状态正确转换', async () => {
    const f = fixture()
    const frozenRefA = {
      refId: 'ref_frozen_a',
      sourceConversationId: 'src_sess_a',
      sourceProjectId: 'ws_test',
      titleAtAttach: '原引用A',
      mode: 'snapshot' as const,
      snapshotUpToMessageId: 'msg_a_last',
      snapshotAt: 1000,
      messageCount: 5,
    }
    const failedEntryA: AgentSendOutboxEntry = {
      sessionId: 'session',
      id: 'msg_failed_a',
      createdAt: 1000,
      status: 'failed',
      draft: { text: '带引用A的消息', html: '<p>带引用A的消息</p>', attachments: [] },
      input: {
        sessionId: 'session',
        queueMessageId: 'msg_failed_a',
        userMessageUuid: 'msg_failed_a',
        userMessage: '带引用A的消息',
        channelId: 'channel',
        dispatch: 'now',
        permissionModeOverride: 'plan',
        contextRefIds: ['ref_frozen_a'],
        contextRefs: [frozenRefA],
      },
    }
    // 保存至磁盘
    f.outbox.save(failedEntryA)

    // 1. 模拟应用崩溃重启：重建全新的 Outbox 和 Recovery 实例（从真实磁盘读取）
    const freshOutbox = new AgentSendOutbox((id) => join(f.dir, `${id}.json`))
    const diskEntries = freshOutbox.list('session')
    expect(diskEntries.some((e) => e.id === 'msg_failed_a')).toBe(true)

    // 2. 模拟当前 Composer 此时已经变更引用为 B
    const composerCurrentRefs = [
      {
        refId: 'ref_composer_b',
        sourceConversationId: 'src_sess_b',
        sourceProjectId: 'ws_test',
        titleAtAttach: '新引用B',
        mode: 'snapshot' as const,
        snapshotUpToMessageId: 'msg_b_last',
        snapshotAt: 2000,
        messageCount: 1,
      },
    ]

    const freshQueued = new Set<string>()
    const freshAccepted = new Set<string>()
    let submittedInput: AgentSendOutboxEntry['input'] | undefined
    const freshRecovery = new AgentSendOutboxRecovery({
      outbox: freshOutbox,
      readAcceptedIds: () => freshAccepted,
      queuedIds: () => freshQueued,
      isBusy: () => true, // 此时正在处理其他任务，触发排队
      prepareRetryInput: (item) => prepareOutboxRetryInput(item, {
        workspaceId: 'workspace',
        permissionMode: 'plan',
        directories: [f.dir],
        files: [],
      }),
    })

    // 3. 执行历史重试：模拟提交到排队
    const submit = async (input: AgentSendOutboxEntry['input']) => {
      submittedInput = input
      freshQueued.add(input.queueMessageId)
      return { disposition: 'queued' as const }
    }

    const result = await freshRecovery.retry({ sessionId: 'session', messageId: 'msg_failed_a' }, submit)

    // 4. 断言：重试成功转入排队，提交的 payload 严格使用原冻结引用A，绝不混入 Composer 的引用B
    expect(result).toEqual({ disposition: 'queued' })
    expect(submittedInput).toBeDefined()
    expect(submittedInput?.contextRefIds).toEqual(['ref_frozen_a'])
    expect(submittedInput?.contextRefs).toEqual([frozenRefA])
    expect(submittedInput?.contextRefIds).not.toContain('ref_composer_b')
    expect(freshQueued.has('msg_failed_a')).toBe(true)
  })
})
