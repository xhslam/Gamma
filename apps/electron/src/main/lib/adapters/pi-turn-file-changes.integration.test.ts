import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@carpus/shared'
import { PiAgentAdapter } from './pi-agent-adapter'
import { setConfigHomeForTest } from '../config-paths'
import { TurnFileChangeStore } from '../turn-file-changes'

test('Given 真实 Pi 与本地模拟模型 When Write 获批执行 Then 快照与同一会话的成功工具结果对应', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'carpus-pi-turn-edits-')))
  const previousConfig = setConfigHomeForTest(root)
  const file = join(root, 'note.txt')
  writeFileSync(file, 'initial\n')
  const adapter = new PiAgentAdapter()
  const store = new TurnFileChangeStore()
  const sessionId = 'local-turn-test'
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    await request.text()
    const call = ++requests === 1
    const delta = call
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'note.txt', content: 'updated\n' }) } }] }
      : { role: 'assistant', content: '已更新' }
    const frame = (value: object, reason: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4o-mini', choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`
    return new Response(`${frame(delta, null)}${frame({}, call ? 'tool_calls' : 'stop')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  try {
    const events: SDKMessage[] = []
    for await (const event of adapter.query({
      sessionId, cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'),
      prompt: '更新测试文件', systemPrompt: '本地测试', permissionMode: 'bypassPermissions',
      provider: 'openai', model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: 'fixture',
      onFileEdit: edit => store.record(sessionId, edit),
    })) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'user',
      message: { content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'call_write', is_error: false })] },
    }))
    const allowed = new Set([file])
    expect(store.summarize(sessionId, ['call_write'], allowed)).toMatchObject({ canUndo: true })
    expect(readFileSync(file, 'utf8')).toBe('updated\n')
    store.undo(sessionId, ['call_write'], allowed)
    expect(readFileSync(file, 'utf8')).toBe('initial\n')
  } finally {
    adapter.dispose()
    await server.stop(true)
    setConfigHomeForTest(previousConfig)
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)
