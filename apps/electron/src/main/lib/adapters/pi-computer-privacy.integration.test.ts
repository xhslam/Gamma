import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ComputerPrivateObservation, SDKMessage } from '@gamma/shared'
import { PiAgentAdapter, type PiAgentQueryOptions } from './pi-agent-adapter'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0m0AAAAASUVORK5CYII='
const ax = 'AX_EPHEMERAL_PRIVACY_CANARY_94b630'
const observation: ComputerPrivateObservation = { observationId: 'opaque-only', epoch: 1, image: { data: png, mimeType: 'image/png', width: 1, height: 1 }, ax }
function response(): Response {
  const frame = (content: object, finish: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4o-mini', choices: [{ index: 0, delta: content, finish_reason: finish }] })}\n\n`
  return new Response(`${frame({ role: 'assistant', content: '离线验证完成' }, null)}${frame({}, 'stop')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('Given 真实Pi适配器、SessionManager和本地模拟provider', () => {
  test('When 观察已取出但发送门禁等待时停止 Then 真实适配器不向本地provider发送旧副本', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-computer-revoke-'))
    let requests = 0, revoked = false, release!: () => void, reached!: () => void
    const entered = new Promise<void>(resolve => { reached = resolve })
    const barrier = new Promise<void>(resolve => { release = resolve })
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { requests += 1; return response() } })
    const adapter = new PiAgentAdapter()
    try {
      const running = (async () => {
        for await (const _event of adapter.query({
          sessionId: 'revoke-test', prompt: '只回复完成', model: 'gpt-4o-mini', provider: 'openai', apiKey: 'local-only',
          baseUrl: `http://127.0.0.1:${server.port}/v1`, cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'),
          permissionMode: 'bypassPermissions', systemPrompt: '本地隐私回归', desktopMode: true,
          getComputerObservations: async () => [observation],
          validateComputerLease: async () => { reached(); await barrier; if (revoked) throw new Error('租约已撤销') },
        })) { /* 消费真实SDK生命周期，不持久化provider请求副本。 */ }
      })().catch(() => {})
      await entered
      revoked = true; adapter.abort('revoke-test'); release()
      await running
      expect(requests).toBe(0)
    } finally {
      release?.(); adapter.dispose(); await server.stop(true); rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)

  test('When 临时观察外发后恢复会话 Then 原图AX只在当次请求，不进入artifact/SDK事件/恢复请求', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-computer-privacy-'))
    const bodies: string[] = [], events: SDKMessage[] = []
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) { bodies.push(await request.text()); return response() } })
    const adapter = new PiAgentAdapter()
    let sdkSessionId = ''
    let artifact = ''
    const base: PiAgentQueryOptions = {
      sessionId: 'privacy-test', prompt: '只回复完成，不使用工具。', model: 'gpt-4o-mini', provider: 'openai',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: 'local-fixture-only', cwd: root,
      piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'), permissionMode: 'bypassPermissions',
      systemPrompt: '只进行本地模拟请求，不调用工具。', desktopMode: true,
      validateComputerLease: async () => {},
      onSessionId: (id, file) => { sdkSessionId = id; artifact = file ?? artifact },
    }
    try {
      for await (const event of adapter.query({ ...base, getComputerObservations: async () => [observation] })) events.push(event)
      expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' })
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toContain(png)
      expect(bodies[0]).toContain(ax)
      expect(artifact).not.toBe('')
      expect(readFileSync(artifact, 'utf8')).not.toContain(ax)
      expect(readFileSync(artifact, 'utf8')).not.toContain(png)
      expect(JSON.stringify(events)).not.toContain(ax)
      expect(JSON.stringify(events)).not.toContain(png)
      for await (const event of adapter.query({ ...base, prompt: '这是恢复后的下一轮，只回复完成。', resumeSessionId: sdkSessionId, getComputerObservations: async () => [] })) events.push(event)
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).not.toContain(ax)
      expect(bodies[1]).not.toContain(png)
      // 扫描真实SDK生成的所有文件，而不是只检查内存消息或截断后的UI投影。
      for (const relative of readdirSync(root, { recursive: true })) {
        if (typeof relative !== 'string' || !/\.(json|jsonl|log)$/.test(relative)) continue
        const text = readFileSync(join(root, relative), 'utf8')
        expect(text).not.toContain(ax)
        expect(text).not.toContain(png)
      }
    } finally {
      adapter.dispose(); await server.stop(true); rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
