import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@gamma/shared'
import { assess, scenarios } from './verify-memory-retrieval'

const messages = (text: string, success = true): SDKMessage[] => [
  { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'read1', name: 'memory_read', input: { path: ['workspace:/areas/exam.md'] } }] } },
  { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'read1', content: '合成成功结果', is_error: !success }] } },
  { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } },
  { type: 'result', subtype: 'success' } as SDKMessage,
]
describe('模型验收指标不伪造成功', () => {
  it('Given 本地协议fixture When 独立脚本跑完39次 Then 结果明确标为非模型验收', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-eval-cli-'))
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const body = await request.json() as { messages: Array<{ role: string }> }
      const scenario = scenarios.find(item => JSON.stringify(body.messages.filter(message => message.role === 'user')).includes(item.query))
      if (!scenario) return new Response('unknown fixture', { status: 400 })
      const tools = scenario.paths.length > 0 && !body.messages.some(message => message.role === 'tool')
      const delta = tools ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read-cli', type: 'function', function: { name: 'memory_read', arguments: JSON.stringify({ path: scenario.paths }) } }] } : { role: 'assistant', content: scenario.facts?.join('，') || '请问你偏爱哪类？' }
      const chunk = (value: unknown, reason: string | null) => `data: ${JSON.stringify({ id: 'eval-fixture', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o-mini', choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`
      return new Response(chunk(delta, null) + chunk({}, tools ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    } })
    try {
      const output = join(root, 'report.json')
      const child = Bun.spawn([process.execPath, new URL('./verify-memory-retrieval.ts', import.meta.url).pathname, '--fixture', '--output', output], { env: { ...process.env, GAMMA_MEMORY_EVAL_API_KEY: 'synthetic-key', GAMMA_MEMORY_EVAL_PROVIDER: 'openai', GAMMA_MEMORY_EVAL_MODEL: 'gpt-4o-mini', GAMMA_MEMORY_EVAL_BASE_URL: `http://127.0.0.1:${server.port}/v1` }, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw new Error(`合成CLI失败：${stdout.slice(-1200)} ${stderr.slice(-1200)}`)
      expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ mode: 'fixture-not-model', total: 39, passed: true, recall: 1, falseRead: 0, violations: 0 })
    } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }) }
  }, 120_000)

  it('Given 13类场景 When 检查 Then 覆盖12类要求及本轮冲突', () => {
    expect(new Set(scenarios.map(scenario => scenario.id)).size).toBe(13)
    expect(scenarios.some(scenario => scenario.id === 'current-turn-wins')).toBe(true)
  })
  it('Given 只有请求或失败 When 计数 Then 不算实际读取', () => {
    const scenario = scenarios.find(item => item.id === 'alias')!
    expect(assess(messages('微积分', false), scenario).passed).toBe(false)
    expect(assess(messages('微积分').filter(item => item.type !== 'user'), scenario).readPaths).toEqual([])
    expect(assess(messages('微积分'), scenario).passed).toBe(true)
  })
  it('Given 读成功但事实错误或违规句式 When 评分 Then 仍失败', () => {
    const scenario = scenarios.find(item => item.id === 'alias')!
    expect(assess(messages('线性代数'), scenario).passed).toBe(false)
    expect(assess(messages('我记得你在复习微积分'), scenario).violations).toBe(1)
    expect(assess(messages('我记得你在复习微积分'), scenario).passed).toBe(false)
  })
  it('Given 日期排版有空格 When 评分 Then 事实相同通过但错误日期仍失败', () => {
    const scenario = scenarios.find(item => item.id === 'current-turn-wins')!
    expect(assess(messages('按你本次的说法，截止日期为 12 月 1 日；原来的 11 月 15 日不再适用。'), scenario).passed).toBe(true)
    expect(assess(messages('截止日期仍然是 11 月 15 日。'), scenario).passed).toBe(false)
    expect(assess(messages('我 记得，截止日期为12月1日。'), scenario).violations).toBe(1)
  })
  it('Given 通用问题误读 When 评分 Then 标记误读', () => {
    expect(assess(messages('使用切片'), scenarios[0]!).readUnexpected).toBe(true)
  })
  it('Given 无凭据 When 独立CLI检查 Then 明示未测且执行拒绝', async () => {
    const script = new URL('./verify-memory-retrieval.ts', import.meta.url).pathname
    const check = Bun.spawn([process.execPath, script, '--check'], { stdout: 'pipe', stderr: 'pipe' })
    expect(JSON.parse(await new Response(check.stdout).text())).toMatchObject({ modelTested: false, total: 39 })
    expect(await check.exited).toBe(0)
    const env = { ...process.env }; delete env.GAMMA_MEMORY_EVAL_API_KEY; delete env.GAMMA_MEMORY_EVAL_MODEL
    const execution = Bun.spawn([process.execPath, script], { env, stdout: 'pipe', stderr: 'pipe' })
    await new Response(execution.stdout).text(); await new Response(execution.stderr).text()
    expect(await execution.exited).toBe(1)
  })
})
