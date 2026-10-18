import { describe, expect, test } from 'bun:test'
import type { WebContents } from 'electron'
import type { AgentDeferredQueueMessageInput } from '@gamma/shared'
import { AgentQueueCoordinator } from './agent-queue-coordinator'

function fixture() {
  const runs: string[] = []
  const finishes: Array<() => void> = []
  const state = { busy: false, targetAvailable: true, sendFails: false, targetThrows: false, generationThrows: false }
  const target = { isDestroyed: () => !state.targetAvailable } as WebContents
  let generation = 0
  const queue = new AgentQueueCoordinator({
    isActive: () => state.busy,
    getWebContents: () => { if (state.targetThrows) throw new Error('窗口解析失败'); return state.targetAvailable ? target : null },
    reserveRunGeneration: () => { if (state.generationThrows) throw new Error('运行身份分配失败'); return ++generation },
    sendStarted: () => { if (state.sendFails) throw new Error('窗口已销毁') },
    startRun: async (input) => { runs.push(input.queueMessageId); await new Promise<void>((resolve) => finishes.push(resolve)) },
  })
  const input = (id: string): AgentDeferredQueueMessageInput => ({ sessionId: 's', queueMessageId: id, userMessage: id, channelId: 'c' })
  const flush = async () => { for (let i = 0; i < 8; ++i) await Promise.resolve() }
  return { queue, runs, finishes, state, input, flush }
}

describe('Given 主进程消息队列持有完整执行生命周期', () => {
  test('When 终态已发布但 computer use 仍在收尾 Then 下一条等执行 Promise 收束后才启动', async () => {
    const f = fixture()
    f.queue.enqueue(f.input('first')); await f.flush()
    f.queue.enqueue(f.input('second'))
    f.queue.onRunComplete('s', 'first', false, false)
    await f.flush()
    expect(f.runs).toEqual(['first'])
    expect(f.queue.isDispatchingMessage('s', 'first')).toBe(true)
    f.finishes[0]!(); await f.flush()
    expect(f.runs).toEqual(['first', 'second'])
    f.finishes[1]!(); await f.flush()
  })

  test('When 启动预检占位中连续提交 Then 先排队，释放占位后按稳定 ID 顺序执行一次', async () => {
    const f = fixture(); f.state.busy = true
    expect(f.queue.enqueue(f.input('first'))).toBe('queued')
    f.queue.enqueue(f.input('first')); f.queue.enqueue(f.input('second'))
    expect(f.queue.snapshot('s').map(({ input }) => input.queueMessageId)).toEqual(['first', 'second'])
    f.state.busy = false; f.queue.onTargetAvailable('s'); await f.flush()
    expect(f.runs).toEqual(['first'])
    f.queue.onRunComplete('s', 'first', false, false); f.finishes[0]!(); await f.flush()
    expect(f.runs).toEqual(['first', 'second'])
    f.finishes[1]!(); await f.flush()
  })

  test('When 用户停止当前轮 Then Promise 收尾、窗口重绑都不自动执行剩余消息，明确新提交后可恢复', async () => {
    const f = fixture()
    f.queue.enqueue(f.input('first')); await f.flush(); f.queue.enqueue(f.input('second'))
    f.queue.onRunComplete('s', 'first', false, true)
    f.finishes[0]!(); await f.flush(); f.queue.onTargetAvailable('s'); f.queue.onBackgroundTaskComplete('s'); await f.flush()
    expect(f.runs).toEqual(['first'])
    expect(f.queue.snapshot('s')).toHaveLength(1)
    f.queue.enqueue(f.input('third')); await f.flush()
    expect(f.runs).toEqual(['first', 'second'])
    f.finishes[1]!(); await f.flush()
    expect(f.runs).toEqual(['first', 'second', 'third'])
    f.finishes[2]!(); await f.flush()
  })

  test('When 有后台任务 Then 收尾不提前接力，后台任务结束才恢复队列', async () => {
    const f = fixture()
    f.queue.enqueue(f.input('first')); await f.flush(); f.queue.enqueue(f.input('second'))
    f.queue.onRunComplete('s', 'first', true, false)
    f.finishes[0]!(); await f.flush()
    expect(f.runs).toEqual(['first'])
    f.queue.enqueue(f.input('third')); await f.flush()
    expect(f.runs).toEqual(['first'])
    f.queue.onBackgroundTaskComplete('s'); await f.flush()
    expect(f.runs).toEqual(['first', 'second'])
    f.finishes[1]!(); await f.flush()
    f.finishes[2]!(); await f.flush()
  })

  test('When 目标窗口不可用或发送 started 失败 Then 消息原位保留并可在目标恢复后执行', async () => {
    const f = fixture(); f.state.targetAvailable = false
    expect(f.queue.enqueue(f.input('first'))).toBe('queued')
    expect(f.queue.snapshot('s')).toHaveLength(1)
    f.state.targetAvailable = true; f.state.sendFails = true; f.queue.onTargetAvailable('s')
    expect(f.queue.snapshot('s')).toHaveLength(1)
    f.state.sendFails = false; f.queue.onTargetAvailable('s'); await f.flush()
    expect(f.runs).toEqual(['first']); f.finishes[0]!(); await f.flush()
  })
  test('When 解析目标窗口或分配运行身份同步抛错 Then 消息保留且释放 dispatch 占位，恢复后可重新启动', async () => {
    for (const key of ['targetThrows', 'generationThrows'] as const) {
      const f = fixture(); f.state[key] = true
      expect(() => f.queue.enqueue(f.input('first'))).not.toThrow()
      expect(f.queue.isDispatching('s')).toBe(false)
      expect(f.queue.snapshot('s').map(({ input }) => input.queueMessageId)).toEqual(['first'])
      f.state[key] = false; f.queue.onTargetAvailable('s'); await f.flush()
      expect(f.runs).toEqual(['first']); f.finishes[0]!(); await f.flush()
    }
  })
})
