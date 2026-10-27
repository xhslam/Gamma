import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import * as shared from '@gamma/shared'
import { loadIsolatedModule } from '../test-utils/isolated-module'

describe('Given utility 的 Agent 查询', () => {
  test('When 重建查询参数 Then 原始 runId 到达 Pi 适配器', async () => {
    let parentListener!: (event: { data: unknown; ports?: unknown[] }) => void
    let portListener!: (event: { data: unknown }) => void
    let captured: Record<string, unknown> | undefined
    let ready: Record<string, unknown> | undefined
    const sent: Record<string, unknown>[] = []
    const parentPort = { on: (_event: string, listener: typeof parentListener) => { parentListener = listener }, start() {} }
    const port = {
      on: (_event: string, listener: typeof portListener) => { portListener = listener },
      postMessage: (message: Record<string, unknown>) => { sent.push(message) },
      start() {}, close() {},
    }
    class FakePiAdapter {
      async *query(input: Record<string, unknown>) { captured = input; yield { type: 'fixture' } }
    }
    loadIsolatedModule(`${import.meta.dir}/agent-runtime.ts`, {
      'node:crypto': { randomUUID },
      '@gamma/shared': shared,
      '../main/lib/adapters/pi-agent-adapter': { PiAgentAdapter: FakePiAdapter },
      './agent-runtime-request-timeout': { getParentRequestTimeoutMs: () => 1000 },
      '../main/lib/computer-logger': { logComputerUseEvent: (entry: Record<string, unknown>) => { ready = entry } },
    }, { process: { parentPort, pid: 1234, env: { GAMMA_APP_VERSION: '1.2.3' } }, AbortController })
    expect(ready).toMatchObject({ event: 'logger-ready', process: 'utility', version: '1.2.3', pid: 1234 })
    parentListener({ data: { type: 'gamma-agent-runtime-port', protocolVersion: shared.AGENT_RUNTIME_PROTOCOL_VERSION }, ports: [port] })
    const bootId = sent[0]?.bootId
    expect(typeof bootId).toBe('string')
    portListener({ data: {
      protocolVersion: shared.AGENT_RUNTIME_PROTOCOL_VERSION,
      bootId, kind: 'request', requestId: 'request-1', method: shared.AGENT_RUNTIME_METHODS.QUERY_START,
      payload: { queryId: 'query-1', input: { sessionId: 'session-1', runId: 'run-1' } },
    } })
    await Promise.resolve()
    expect(captured?.runId).toBe('run-1')
  })
})
