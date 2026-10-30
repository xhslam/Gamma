import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@gamma/shared'
import { PiAgentAdapter } from './adapters/pi-agent-adapter'
import { patchMemoryMetadata } from './memory-metadata'

interface RequestBody { messages: Array<{ role: string; content?: unknown }>; tools?: unknown[] }
function frame(delta: Record<string, unknown>, reason: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'memory-retrieval', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o-mini', choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`
}
function response(text: string): Response { return new Response(`${frame({ role: 'assistant', content: text })}${frame({}, 'stop')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }) }
function toolResponse(paths: string[]): Response {
  return new Response(`${frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'read-memory-1', type: 'function', function: { name: 'memory_read', arguments: JSON.stringify({ path: paths }) } }] })}${frame({}, 'tool_calls')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}
function seed(root: string, name: string, description: string, aliases: string[], body: string): void {
  mkdirSync(join(root, 'areas'), { recursive: true })
  writeFileSync(join(root, `areas/${name}.md`), patchMemoryMetadata(body, { name: `${name}.md`, description, sources: [], aliases }))
}
async function runFixture(query: string, respond: (request: RequestBody, index: number) => Response, nextRound?: { update?: boolean }): Promise<{ requests: RequestBody[]; events: SDKMessage[] }> {
  const root = mkdtempSync(join(tmpdir(), 'gamma-memory-runtime-')); const global = join(root, 'global'); const workspace = join(root, 'workspace')
  seed(global, 'exam', '秋考的截止日期和复习安排，安排秋考时读', ['秋考'], '- [stated] 截止日期是11月15日。\n')
  seed(workspace, 'exam', '秋考的当前科目与复习安排，安排秋考时读', ['秋考'], '- [stated] 科目是微积分。\n')
  const requests: RequestBody[] = []; const events: SDKMessage[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) { const body = await request.json() as RequestBody; requests.push(body); return respond(body, requests.length) } })
  const adapter = new PiAgentAdapter()
  try {
    const input = { sessionId: 'memory-test', prompt: query, memoryUserMessage: query, model: 'gpt-4o-mini', provider: 'openai' as const, apiKey: 'fixture-key', baseUrl: `http://127.0.0.1:${server.port}/v1`, cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'), systemPrompt: '你是测试助手。', permissionMode: 'bypassPermissions' as const, memoryEnabled: true, memoryRoot: global, memoryWorkspaceRoot: workspace }
    for await (const event of adapter.query(input)) events.push(event)
    if (nextRound) {
      const init = events.find(event => event.type === 'system' && event.subtype === 'init')
      if (!init || init.type !== 'system') throw new Error('没有可恢复的Pi会话')
      if (nextRound.update) seed(workspace, 'exam', '秋考的当前科目与复习安排，安排秋考时读', ['秋考'], '- [stated] 科目改为统计学。\n')
      for await (const event of adapter.query({ ...input, resumeSessionId: init.session_id })) events.push(event)
    }
    return { requests, events }
  } finally { adapter.dispose(); await server.stop(true); rmSync(root, { recursive: true, force: true }) }
}

describe('Pi真实生命周期下的提取与一次性兜底', () => {
  it('Given 模型首步漏读 When 应用兜底 Then 先隐藏错误答案、读取两个作用域后只显示最终回答', async () => {
    const { requests, events } = await runFixture('我的秋考安排和截止日期是什么？', (_request, index) => index === 1 ? response('我没有你的秋考信息。') : index === 2 ? toolResponse(['global:/areas/exam.md', 'workspace:/areas/exam.md']) : response('截止日期是11月15日，科目是微积分。'))
    expect(requests).toHaveLength(3)
    expect(JSON.stringify(requests[0])).toContain('<memory_listing>')
    expect(JSON.stringify(requests[0])).not.toContain('科目是微积分')
    expect(JSON.stringify(requests[1])).toContain('请先 memory_read 再回答')
    expect(JSON.stringify(requests[2])).toContain('科目是微积分')
    expect(JSON.stringify(events)).not.toContain('我没有你的秋考信息')
    expect(JSON.stringify(events)).toContain('截止日期是11月15日')
    expect(JSON.stringify(events)).toContain('memory_read')
  }, 20000)
  it('Given 模型持续拒绝读 When 兜底一次仍漏读 Then 不循环、不伪造工具成功', async () => {
    const { requests, events } = await runFixture('我的秋考安排是什么？', () => response('请补充本次安排。'))
    expect(requests).toHaveLength(2)
    expect(events.filter(event => event.type === 'assistant')).toHaveLength(1)
  }, 20000)
  it('Given 上轮已完整读取 When 恢复会话版本未变 Then 不强制重复读取且不累加system规则', async () => {
    const { requests } = await runFixture('我的秋考安排是什么？', (_request, index) => index === 1 ? toolResponse(['global:/areas/exam.md', 'workspace:/areas/exam.md']) : response('截止日期是11月15日，科目是微积分。'), {})
    expect(requests).toHaveLength(3)
    expect(JSON.stringify(requests[2])).not.toContain('请先 memory_read 再回答')
    const system = requests[2]!.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('')
    expect(system.match(/<memory_listing>\n/g)).toHaveLength(1)
    expect(system.match(/<memory_recording_rules>/g)).toHaveLength(1)
    expect(system.match(/<memory_rules>/g)).toHaveLength(1)
  }, 20000)
  it('Given 已读文件外部变更 When 恢复会话 Then 通知更新、屏蔽旧正文并要求重读', async () => {
    const { requests } = await runFixture('我的秋考安排是什么？', (_request, index) => index === 1 || index === 4 ? toolResponse(['global:/areas/exam.md', 'workspace:/areas/exam.md']) : response('按当前科目安排。'), { update: true })
    expect(requests).toHaveLength(5)
    expect(JSON.stringify(requests[2])).toContain('<memory_updates>')
    expect(JSON.stringify(requests[2])).toContain('已变更，请重读')
    expect(JSON.stringify(requests[2])).not.toContain('科目是微积分')
    expect(JSON.stringify(requests[4])).toContain('科目改为统计学')
  }, 20000)
  it('Given 通用问题 When 目录含同主题文件 Then 不重试且没有读入正文', async () => {
    const { requests } = await runFixture('Python 里怎么反转列表？', () => response('使用列表切片 items[::-1]。'))
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0])).not.toContain('科目是微积分')
    expect(JSON.stringify(requests[0])).not.toContain('本轮消息可能涉及')
  }, 20000)
})
