import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentSendOutboxEntry } from '@gamma/shared'
import { AgentSendOutbox, parseSendOutboxEntry } from './agent-send-outbox'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gamma-outbox-')); roots.push(dir)
  const resolvePath = (id: string) => join(dir, `${id}.json`)
  return { resolvePath, store: new AgentSendOutbox(resolvePath) }
}
function entry(sessionId = 'session', id = 'message'): AgentSendOutboxEntry {
  return {
    id, sessionId, createdAt: 10, status: 'pending',
    draft: { text: '原始正文 &quote:引用', html: '<p>原始<strong>正文</strong></p>', attachments: [{ filename: '图.png', mediaType: 'image/png', size: 32, targetPath: '/session/图.png' }] },
    input: { sessionId, queueMessageId: id, userMessageUuid: id, channelId: 'channel', userMessage: '<引用>\n正文', rawUserMessage: '原文', dispatch: 'after_current', mentionedSkills: ['skill'], additionalDirectories: ['/project'] },
  }
}

describe('Given 原子 JSON 发送日志', () => {
  test('When 重建实例模拟重启 Then 完整恢复正文/HTML/附件/发送引用且不触发执行', () => {
    const f = fixture(); f.store.save(entry())
    expect(new AgentSendOutbox(f.resolvePath).list('session')).toEqual([entry()])
    expect(f.store.list('other-session')).toEqual([])
  })
  test('When 同一 ID 重试失败 Then 原位更新且不创建重复日志', () => {
    const f = fixture(); f.store.save(entry()); f.store.save({ ...entry(), status: 'failed', error: '离线' })
    expect(f.store.list('session')).toEqual([{ ...entry(), status: 'failed', error: '离线' }])
  })
  test('When 只确认其中一条已持久化 Then 仅清理该 ID，其余仍可重启恢复', () => {
    const f = fixture(); f.store.save(entry()); f.store.save(entry('session', 'other'))
    f.store.acknowledge('session', new Set(['message']))
    expect(new AgentSendOutbox(f.resolvePath).list('session').map((item) => item.id)).toEqual(['other'])
  })
  test('When 跨会话、ID不一致、相对附件路径或非法权限输入 Then 拒绝且不覆盖旧日志', () => {
    const f = fixture(); f.store.save(entry()); const original = readFileSync(f.resolvePath('session'), 'utf8')
    expect(() => parseSendOutboxEntry(entry(), 'other')).toThrow()
    expect(() => f.store.save({ ...entry(), input: { ...entry().input, userMessageUuid: 'different' } })).toThrow()
    expect(() => f.store.save({ ...entry(), draft: { ...entry().draft, attachments: [{ ...entry().draft.attachments[0]!, targetPath: '../secret' }] } })).toThrow()
    expect(readFileSync(f.resolvePath('session'), 'utf8')).toBe(original)
  })
  test('When 输入包含内部运行字段或凭据 Then 只保存公开白名单', () => {
    const parsed = parseSendOutboxEntry({ ...entry(), input: { ...entry().input, runGeneration: 999, apiKey: 'not-a-real-key', triggeredBy: 'automation', automationContext: 'injected' } }, 'session')
    expect(parsed.input).not.toHaveProperty('runGeneration')
    expect(parsed.input).not.toHaveProperty('apiKey')
    expect(parsed.input).not.toHaveProperty('triggeredBy')
  })
  test('When 磁盘损坏 Then 显式失败并保留证据，不覆盖为空列表', () => {
    const f = fixture(); writeFileSync(f.resolvePath('session'), '{broken')
    expect(() => f.store.list('session')).toThrow()
    expect(() => f.store.save(entry())).toThrow()
    expect(readFileSync(f.resolvePath('session'), 'utf8')).toBe('{broken')
  })
  test('When 达到条数上限 Then 不静默淘汰旧失败消息', () => {
    const f = fixture()
    for (let i = 0; i < 100; i++) f.store.save(entry('session', `id-${i}`))
    expect(() => f.store.save(entry('session', 'overflow'))).toThrow('100')
    expect(f.store.list('session')).toHaveLength(100)
  })
})

describe('Given 发送前日志与严格历史证据', () => {
  test('When 历史读取失败或任一行损坏 Then 拒绝去重判定而非返回空历史', async () => {
    const { readPersistedOutboxUserIds } = await import('./agent-send-outbox')
    const f = fixture()
    writeFileSync(f.resolvePath('history'), '{"type":"user","uuid":"message"}\n{broken\n')
    expect(() => readPersistedOutboxUserIds(f.resolvePath('history'))).toThrow('损坏')
    expect(() => readPersistedOutboxUserIds(f.resolvePath('history') + '/not-readable')).toThrow('无法验证')
    writeFileSync(f.resolvePath('history'), '{"type":"user","uuid":"message"}\n{"type":"assistant","uuid":"reply"}\n')
    expect([...readPersistedOutboxUserIds(f.resolvePath('history'))]).toEqual(['message'])
  })
})
