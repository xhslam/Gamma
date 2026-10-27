import { describe, expect, test } from 'bun:test'
import {
  AGENT_RUNTIME_BOOTSTRAP_ID,
  AGENT_RUNTIME_PROTOCOL_VERSION,
} from '../types/agent-runtime'
import {
  createAgentRuntimeRequest,
  createAgentRuntimeResponse,
  isAgentRuntimeEnvelope,
  serializeAgentRuntimeError,
} from './agent-runtime'

describe('Agent runtime protocol', () => {
  test('creates a request with session and query identity', () => {
    const request = createAgentRuntimeRequest(
      'agent.query.start',
      { value: 1 },
      { sessionId: 'session-a', queryId: 'query-a' },
    )

    expect(request.protocolVersion).toBe(AGENT_RUNTIME_PROTOCOL_VERSION)
    expect(request.bootId).toBe(AGENT_RUNTIME_BOOTSTRAP_ID)
    expect(request.kind).toBe('request')
    expect(request.sessionId).toBe('session-a')
    expect(request.queryId).toBe('query-a')
    expect(isAgentRuntimeEnvelope(request)).toBe(true)
  })

  test('keeps request identity on the response', () => {
    const request = createAgentRuntimeRequest(
      'agent.query.start',
      undefined,
      { sessionId: 'session-b', queryId: 'query-b' },
      'boot-b',
    )
    const response = createAgentRuntimeResponse(request, { payload: { accepted: true } }, 'boot-b')

    expect(response.ok).toBe(true)
    expect(response.requestId).toBe(request.requestId)
    expect(response.sessionId).toBe('session-b')
    expect(response.queryId).toBe('query-b')
    expect(response.bootId).toBe('boot-b')
  })

  test('serializes unknown errors without throwing', () => {
    expect(serializeAgentRuntimeError(new Error('boom'), 'test.error')).toMatchObject({
      code: 'test.error',
      message: 'boom',
    })
    expect(serializeAgentRuntimeError('bad input')).toMatchObject({
      code: 'runtime.internal_error',
      message: 'bad input',
    })
  })
})

test('Given 带业务 code/details 的 Error When 跨进程序列化 Then 保留 message 和业务详情', () => {
  const original = Object.assign(new Error('本轮电脑操作已暂停'), { code: 'computer.run-paused', details: { stopReason: '用户接管' } })
  const wire = serializeAgentRuntimeError(original)
  expect(wire).not.toBeInstanceOf(Error)
  expect(structuredClone(wire)).toEqual({ code: 'computer.run-paused', message: '本轮电脑操作已暂停', details: { stopReason: '用户接管' } })
  expect(JSON.parse(JSON.stringify(wire))).toEqual(structuredClone(wire))
})
