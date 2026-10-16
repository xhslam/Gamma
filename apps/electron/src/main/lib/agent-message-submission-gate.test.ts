import { describe, expect, test } from 'bun:test'
import { AgentMessageSubmissionGate } from './agent-message-submission-gate'

describe('Given 普通发送、队列与重试共用的主进程幂等入口', () => {
  test('When 另一窗口已持久化同 ID Then 跳过模型执行并回执已接收', async () => {
    const gate = new AgentMessageSubmissionGate({ isPersisted: () => true, isQueued: () => false })
    let calls = 0
    expect(await gate.submit('session', 'id', async () => { ++calls })).toEqual({ duplicate: true, acceptedAs: 'persisted' })
    expect(calls).toBe(0)
  })
  test('When 保存和提交两个 IPC 之间另一窗口接受消息 Then 提交仍被主进程拦截', async () => {
    let accepted = false, calls = 0
    const gate = new AgentMessageSubmissionGate({ isPersisted: () => accepted, isQueued: () => false })
    // 模拟旧窗口已保存快照；不依赖其过期的保存结果。
    accepted = true
    await gate.submit('session', 'id', async () => { ++calls })
    expect(calls).toBe(0)
  })
  test('When 两窗口同时提交 Then 仅一个 operation，另一份共享等待结果', async () => {
    let accepted = false, calls = 0
    const gate = new AgentMessageSubmissionGate({ isPersisted: () => accepted, isQueued: () => false })
    const operation = async () => { ++calls; await Bun.sleep(10); accepted = true; return 'done' }
    const results = await Promise.all([gate.submit('session', 'id', operation), gate.submit('session', 'id', operation)])
    expect(calls).toBe(1)
    expect(results).toEqual([{ duplicate: false, value: 'done' }, { duplicate: true, acceptedAs: 'persisted' }])
  })
  test('When 队列已移出但仍在启动预检 Then 仍视为已入队，不重复注入', async () => {
    const gate = new AgentMessageSubmissionGate({ isPersisted: () => false, isQueued: () => true })
    let calls = 0
    expect(await gate.submit('session', 'id', async () => { ++calls })).toEqual({ duplicate: true, acceptedAs: 'queued' })
    expect(calls).toBe(0)
  })
  test('When 第一次提交失败或没有接受证据 Then 释放门禁并保留重试机会', async () => {
    const gate = new AgentMessageSubmissionGate({ isPersisted: () => false, isQueued: () => false })
    await expect(gate.submit('session', 'id', async () => { throw new Error('失败') })).rejects.toThrow('失败')
    const first = gate.submit('session', 'id', async () => { await Bun.sleep(5); return 'unconfirmed' })
    const second = gate.submit('session', 'id', async () => 'should-not-run')
    await first; await expect(second).rejects.toThrow('尚无接收证据')
    expect(await gate.submit('session', 'id', async () => 'retry')).toEqual({ duplicate: false, value: 'retry' })
  })
  test('When 会话不同或 ID 不同 Then 不相互阻塞；历史异常仍失败关闭', async () => {
    const gate = new AgentMessageSubmissionGate({ isPersisted: () => false, isQueued: () => false })
    const results = await Promise.all([gate.submit('a', 'id', async () => 1), gate.submit('b', 'id', async () => 2), gate.submit('a', 'new-id', async () => 3)])
    expect(results.map((result) => result.duplicate)).toEqual([false, false, false])
    const broken = new AgentMessageSubmissionGate({ isPersisted: () => { throw new Error('损坏') }, isQueued: () => false })
    await expect(broken.submit('a', 'id', async () => 'never')).rejects.toThrow('损坏')
  })
})
