import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentContextRef } from '@gamma/shared'
import { setConfigHomeForTest } from '../config-paths'
import { appendSDKMessages, createAgentSession, updateAgentContextRefs } from '../agent-session-manager'
import { PiAgentAdapter } from '../adapters/pi-agent-adapter'

test('Given真实Pi正在处理A When追加带B快照的用户消息 Then消费B之前工具仍用A且消费后仅注入B', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gamma-pi-reference-queue-')), previous = setConfigHomeForTest(root)
  const adapter = new PiAgentAdapter(), bodies: string[] = []
  let target = '', a: AgentContextRef[] = [], b: AgentContextRef[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    bodies.push(await request.text())
    const count = bodies.length
    if (count === 1) await adapter.sendQueuedMessage(target, { type: 'user', uuid: 'queued-b', session_id: target, parent_tool_use_id: null, message: { role: 'user', content: '现在读取B资料' } }, { contextRefs: b })
    const tool = count === 1 ? { name: 'list_referenced_conversations', arguments: '{}' } : count === 3 ? { name: 'read_referenced_conversation', arguments: JSON.stringify({ id: b[0]!.refId, offset: 0, limit: 1 }) } : undefined
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${count}`, type: 'function', function: tool }] } : { role: 'assistant', content: '本地链路完成' }
    const frame = (value: object, finish: string | null): string => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4o-mini', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`
    return new Response(`${frame(delta, null)}${frame({}, tool ? 'tool_calls' : 'stop')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  try {
    const sourceA = await createAgentSession('A资料'), sourceB = await createAgentSession('B资料')
    target = (await createAgentSession('目标')).id
    for (const [id, text] of [[sourceA.id, 'queue-A-canary'], [sourceB.id, 'queue-B-canary']] as const) appendSDKMessages(id, [{ type: 'user', uuid: `msg-${id}`, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } }])
    a = updateAgentContextRefs(target, [{ refId: 'ignored', sourceConversationId: sourceA.id, sourceProjectId: '', titleAtAttach: '', mode: 'snapshot' }])
    b = updateAgentContextRefs(target, [{ refId: 'ignored', sourceConversationId: sourceB.id, sourceProjectId: '', titleAtAttach: '', mode: 'snapshot' }])
    for await (const _ of adapter.query({ sessionId: target, contextRefs: a, prompt: '先处理A资料', systemPrompt: '仅测试本地引用队列链路。', provider: 'openai', model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: 'local-fixture', cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'), permissionMode: 'bypassPermissions' })) { /* 真实SDK运行到自然终态 */ }
    expect(bodies).toHaveLength(4)
    const lastUser = (body: string): string => {
      const payload = JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> }
      return JSON.stringify(payload.messages.filter((message) => message.role === 'user').at(-1)?.content)
    }
    expect(lastUser(bodies[1]!)).toContain(a[0]!.refId)
    expect(lastUser(bodies[1]!)).not.toContain(b[0]!.refId)
    expect(bodies[1]).toContain(a[0]!.refId)
    expect(lastUser(bodies[2]!)).toContain(b[0]!.refId)
    expect(lastUser(bodies[2]!)).not.toContain(a[0]!.refId)
    expect(bodies[3]).toContain('queue-B-canary')
    expect(bodies[3]).not.toContain('[错误]')
  } finally { adapter.dispose(); await server.stop(true); setConfigHomeForTest(previous); rmSync(root, { recursive: true, force: true }) }
}, 20_000)
