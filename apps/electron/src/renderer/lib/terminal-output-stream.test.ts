import { describe, expect, test } from 'bun:test'
import { TerminalOutputStream } from './terminal-output-stream'

function setup(maxPendingChars = 1_000_000) {
  const writes: string[] = []
  const callbacks: Array<() => void> = []
  const errors: unknown[] = []
  const stream = new TerminalOutputStream({
    write: (data, callback) => { writes.push(data); callbacks.push(callback) },
    onError: (error) => errors.push(error),
    maxPendingChars,
  })
  return { stream, writes, errors, finish: () => callbacks.shift()?.() }
}

const event = (sequence: number, data = `${sequence}`) => ({ terminalId: 'test', sequence, data })

describe('终端快照与实时输出流', () => {
  test('Given 快照和实时事件重叠 When 恢复 Then 历史仅重放一次并按序串行解析后续事件', () => {
    const { stream, writes, finish } = setup()
    stream.push(event(1))
    stream.push(event(2))
    stream.restore('history', 1)
    expect(writes).toEqual(['history'])
    expect(stream.isReplaying).toBe(true)
    finish()
    expect(stream.isReplaying).toBe(false)
    expect(writes).toEqual(['history', '2'])
    stream.push(event(2))
    stream.push(event(3))
    finish()
    expect(writes).toEqual(['history', '2', '3'])
  })

  test('Given live batch 尚未解析 When 收到重复事件 Then 提交序号立即去重而不是等 callback', () => {
    const { stream, writes, finish } = setup()
    stream.restore('', 0)
    finish()
    stream.push(event(1))
    stream.push(event(1))
    finish()
    expect(writes.filter(Boolean)).toEqual(['1'])
  })

  test('Given 快照读取失败 When 用空快照恢复 Then 释放已收到的实时输出', () => {
    const { stream, writes, finish } = setup()
    stream.push(event(1, 'prompt'))
    stream.restore('', 0)
    finish()
    expect(writes).toEqual(['', 'prompt'])
  })

  test('Given 没有遵守解析 credit 的生产者 When 队列超过容量 Then 显式报错而非静默丢弃终端查询', () => {
    const { stream, errors, finish } = setup(10)
    stream.restore('', 0)
    finish()
    stream.push(event(1, 'first'))
    for (let index = 2; index <= 100; index++) stream.push(event(index, 'abcdefgh'))
    expect(stream.pendingChars).toBe(0)
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('终端解析队列超过容量')
    finish()
  })

  test('Given 慢解析和 DSR 后跟随大量输出 When 生产者遵守逐批 credit Then 查询完整解析且队列始终有界', () => {
    const writes: string[] = []
    const callbacks: Array<() => void> = []
    let sequence = 0
    const stream = new TerminalOutputStream({
      write: (data, callback) => { writes.push(data); callbacks.push(callback) },
      onError: (error) => { throw error },
      onParsed: (parsedSequence) => {
        sequence = parsedSequence + 1
        if (sequence < 100) stream.push(event(sequence, sequence === 2 ? '\x1b[6n' : 'x'.repeat(64 * 1024)))
      },
    })
    stream.restore('', 0)
    callbacks.shift()?.()
    stream.push(event(1, 'start'))
    for (let step = 0; step < 100; step++) {
      expect(stream.pendingChars).toBeLessThanOrEqual(64 * 1024)
      callbacks.shift()?.()
    }
    expect(writes.join('')).toContain('\x1b[6n')
    expect(writes.join('')).not.toContain('丢弃')
  })

  test('Given 输出待解析 When 卸载后 callback 返回 Then 不再写入或调用恢复回调', () => {
    const { stream, writes, finish } = setup()
    let restored = false
    stream.restore('history', 0, () => { restored = true })
    stream.push(event(1))
    stream.dispose()
    finish()
    expect(restored).toBe(false)
    expect(writes).toEqual(['history'])
    expect(stream.pendingChars).toBe(0)
  })

  test('Given xterm.write 抛错 When 输出解析 Then 可见错误且不无限积压', () => {
    const errors: unknown[] = []
    const stream = new TerminalOutputStream({ write: () => { throw new Error('parser failed') }, onError: (error) => errors.push(error) })
    stream.restore('history', 0)
    expect(errors).toHaveLength(1)
    expect(stream.pendingChars).toBe(0)
  })
})
