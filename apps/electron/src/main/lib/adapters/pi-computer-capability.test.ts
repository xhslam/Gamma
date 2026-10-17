import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import * as shared from '@gamma/shared'
import type { AgentRuntimeEvent, AgentRuntimeRequest, ComputerPrivateObservation } from '@gamma/shared'
import type { PiAgentQueryOptions } from './pi-agent-adapter'
import { loadIsolatedModule } from '../../../test-utils/isolated-module'

type AdapterModule = typeof import('./pi-utility-adapter')
const M = shared.AGENT_RUNTIME_METHODS
const privateObservation: ComputerPrivateObservation = { observationId: 'opaque', epoch: 1, image: { data: 'IMAGE_PRIVATE_CANARY', mimeType: 'image/png', width: 1, height: 1 }, ax: 'AX_PRIVATE_CANARY' }
function setup() {
  const clients: FakeClient[] = []
  const stops: string[] = []
  class FakeClient {
    queryId = ''
    serialized: unknown
    stopped = false
    abortBarrier?: Promise<void>
    request!: (request: AgentRuntimeRequest) => Promise<unknown>
    event!: (event: AgentRuntimeEvent) => void
    constructor(readonly options: { sessionId: string }) { clients.push(this) }
    setRequestHandler(handler: typeof this.request) { this.request = handler }
    onEvent(handler: typeof this.event) { this.event = handler; return () => {} }
    async call(method: string, payload: Record<string, unknown>) {
      if (method === M.QUERY_START) { this.queryId = String(payload.queryId); this.serialized = payload.input }
      if (method === M.QUERY_ABORT) await this.abortBarrier
      return { accepted: true, completed: true }
    }
    async stop() { this.stopped = true }
    emit(method: string, queryId = this.queryId, sessionId = this.options.sessionId) {
      this.event({ protocolVersion: 1, bootId: 'fixture', kind: 'event', method, queryId, sessionId })
    }
    read(queryId = this.queryId, sessionId = this.options.sessionId, method: string = M.CAPABILITY_COMPUTER_OBSERVATIONS) {
      return this.request({ protocolVersion: 1, bootId: 'fixture', kind: 'request', method, requestId: randomUUID(), queryId, sessionId, payload: { queryId } })
    }
  }
  const { PiUtilityAdapter } = loadIsolatedModule<AdapterModule>(`${import.meta.dir}/pi-utility-adapter.ts`, {
    'node:crypto': { randomUUID }, '@gamma/shared': shared,
    '../agent-runtime-client': { AgentRuntimeClient: FakeClient },
    '../computer-service': { computerController: { stopForSession: async (sessionId: string) => { stops.push(sessionId) } } },
  }, { AbortController })
  const adapter = new PiUtilityAdapter()
  function start(sessionId: string, getComputerObservations: () => Promise<ComputerPrivateObservation[]> = async () => [privateObservation], desktopMode = true) {
    const iterator = adapter.query({ sessionId, desktopMode, getComputerObservations, validateComputerLease: async () => {} } as unknown as PiAgentQueryOptions)[Symbol.asyncIterator]()
    const first = iterator.next()
    // 立即绑定拒绝处理，防止dispose测试的队列拒绝成为unhandled rejection。
    const settled = first.then(value => ({ value }), error => ({ error: error as unknown }))
    const client = clients.at(-1)!
    return { client, settled, finish: async () => { client.emit(M.EVENT_QUERY_END); await settled } }
  }
  return { adapter, start, stops }
}

describe('Given main到utility的私有观察capability（无Electron、无网络）', () => {
  test('When 当前owner query读取 Then 只在RPC返回且不进入query启动数据', async () => {
    const { start } = setup(); const query = start('s1')
    expect(await query.client.read()).toEqual([privateObservation])
    expect(JSON.stringify(query.client.serialized)).not.toContain('PRIVATE_CANARY')
    expect(query.client.serialized).not.toHaveProperty('getComputerObservations')
    expect(query.client.serialized).not.toHaveProperty('validateComputerLease')
    await expect(query.client.read(query.client.queryId, 's1', M.CAPABILITY_COMPUTER_VALIDATE)).resolves.toBeUndefined()
    await query.finish()
    await expect(query.client.read()).rejects.toThrow()
  })
  test('When 非桌面模式、跨query或跨session读取 Then 全部拒绝', async () => {
    const { start } = setup(); const a = start('a'); const b = start('b'); const normal = start('normal', async () => [privateObservation], false)
    await expect(a.client.read(b.client.queryId, 'b')).rejects.toThrow()
    await expect(a.client.read(a.client.queryId, 'b')).rejects.toThrow()
    await expect(normal.client.read()).rejects.toThrow()
    await expect(a.client.read(b.client.queryId, 'b', M.CAPABILITY_COMPUTER_VALIDATE)).rejects.toThrow()
    await expect(normal.client.read(normal.client.queryId, 'normal', M.CAPABILITY_COMPUTER_VALIDATE)).rejects.toThrow()
    await Promise.all([a.finish(), b.finish(), normal.finish()])
  })
  test('When 已读取但主进程await期间停止 Then 迟到原图不能交付', async () => {
    let complete!: (value: ComputerPrivateObservation[]) => void
    const { adapter, start, stops } = setup()
    const query = start('s1', () => new Promise(resolve => { complete = resolve }))
    const reading = query.client.read()
    await adapter.abort('s1')
    complete([privateObservation])
    await expect(reading).rejects.toThrow()
    expect(stops).toContain('s1')
    await query.finish()
  })
  test('When query结束或adapter释放 Then 立即撤权并拒绝后续读取', async () => {
    const { adapter, start, stops } = setup(); const query = start('s1')
    adapter.dispose()
    expect(stops).toContain('s1')
    await expect(query.client.read()).rejects.toThrow()
    await query.settled
  })
  test('When 撤权取消与stopAndDrain重复abort Then 都等待同一utility退出屏障', async () => {
    const { adapter, start } = setup(); const query = start('s1')
    let release!: () => void, firstDone = false, secondDone = false
    query.client.abortBarrier = new Promise(resolve => { release = resolve })
    const first = adapter.abort('s1').then(() => { firstDone = true })
    const second = adapter.abort('s1').then(() => { secondDone = true })
    await Promise.resolve(); await Promise.resolve()
    expect(firstDone).toBe(false); expect(secondDone).toBe(false)
    expect(query.client.stopped).toBe(false)
    release(); await Promise.all([first, second])
    expect(query.client.stopped).toBe(true)
    await query.finish()
  })
  test('When 一个utility伪造其他query结束事件 Then 不影响其他owner', async () => {
    const { start, stops } = setup(); const a = start('a'); const b = start('b')
    a.client.emit(M.EVENT_QUERY_END, b.client.queryId, 'b')
    expect(stops).not.toContain('b')
    expect(await b.client.read()).toEqual([privateObservation])
    await Promise.all([a.finish(), b.finish()])
  })
})
