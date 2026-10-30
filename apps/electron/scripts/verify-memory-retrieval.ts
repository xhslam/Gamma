#!/usr/bin/env bun
/** 仅使用临时合成数据；未配凭据时拒绝把fixture冒充真实模型验收。 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SDKMessage } from '@gamma/shared'
import { patchMemoryMetadata } from '../src/main/lib/memory-metadata'
import { setConfigHomeForTest } from '../src/main/lib/config-paths'
import { writeTextFileAtomic } from '../src/main/lib/safe-file'

interface Scenario { id: string; query: string; paths: string[]; facts?: string[]; absent?: string[]; batch?: boolean; optionalRead?: boolean }
export const scenarios: Scenario[] = [
  { id: 'general', query: 'Python里怎么反转列表？', paths: [] },
  { id: 'alias', query: '我的秋考现在要复习什么？', paths: ['workspace:/areas/exam.md'], facts: ['微积分'] },
  { id: 'multi-file', query: '给同事小王写个交接说明，结合我的交接安排。', paths: ['global:/people/wang.md', 'workspace:/areas/handover.md'], facts: ['接口联调', '周四'], batch: true },
  { id: 'direct-fact', query: '我的秋考截止日期是哪天？', paths: ['workspace:/areas/exam.md'], facts: ['11月15日'] },
  { id: 'existence', query: '你有没有我的秋考安排？有的话说下具体科目。', paths: ['workspace:/areas/exam.md'], facts: ['微积分'] },
  { id: 'missing-fact', query: '我喜欢什么类型的电影？', paths: ['global:/topics/movies.md'], absent: ['科幻片', '恐怖片'] },
  { id: 'sensitive', query: '推荐一个晚餐菜谱。', paths: [], absent: ['高血压', '医疗病史', '健康笔记'] },
  { id: 'preferences', query: '2加3等于几？只回答结果。', paths: [], facts: ['5'] },
  { id: 'third-party', query: '介绍常见的团队沟通技巧。', paths: [], absent: ['小王', '接口联调'] },
  { id: 'unfinished', query: '早上好。', paths: [], absent: ['秋考', '复习', '进度'] },
  { id: 'no-memory-prefix', query: '我的交接安排是哪天？', paths: ['workspace:/areas/handover.md'], facts: ['周四'] },
  { id: 'dual-scope', query: '我的双域项目各有什么约定？请都告诉我。', paths: ['global:/topics/shared.md', 'workspace:/topics/shared.md'], facts: ['中文注释', '周五验收'], batch: true },
  { id: 'current-turn-wins', query: '我的秋考截止日期已改为12月1日，请按新的日期回答是哪天。不要修改文件。', paths: [], optionalRead: true, facts: ['12月1日'] },
]
const prohibited = /根据我的记忆|根据记忆|你的档案|我记得/g
/** 排除日期等事实中的排版空格差异，不改变事实内容或验收阈值。 */
function normalizeEvaluationText(text: string): string { return text.normalize('NFKC').replace(/\s+/g, '') }
function canonical(path: string): string { return /^(global|workspace):/.test(path) ? path.replace(/:\/?/, ':/') : `global:/${path.replace(/^\/+/, '')}` }
export function assess(events: SDKMessage[], scenario: Scenario): { passed: boolean; readPaths: string[]; response: string; violations: number; readExpected: boolean; readUnexpected: boolean; batch: boolean } {
  const calls = new Map<string, string[]>()
  const successful = new Set<string>()
  const text: string[] = []
  let failed = false
  let completed = false
  for (const event of events) {
    if (event.type === 'result') { completed = true; if (event.subtype !== 'success') failed = true }
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') text.push(block.text)
        if (block.type === 'tool_use' && block.name === 'memory_read' && typeof block.id === 'string' && block.input && typeof block.input === 'object') {
          const path = (block.input as Record<string, unknown>).path
          calls.set(block.id, (Array.isArray(path) ? path : [path]).filter((value): value is string => typeof value === 'string').map(canonical))
        }
      }
    }
    if (event.type === 'user') for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_result' && !block.is_error && typeof block.tool_use_id === 'string' && calls.has(block.tool_use_id)) successful.add(block.tool_use_id)
    }
  }
  const readPaths = [...new Set([...successful].flatMap(id => calls.get(id) ?? []))]
  const response = text.join('\n')
  const normalizedResponse = normalizeEvaluationText(response)
  const violations = [...normalizedResponse.matchAll(prohibited)].length
  const readExpected = scenario.paths.every(path => readPaths.includes(path))
  const readUnexpected = scenario.paths.length === 0 && !scenario.optionalRead && readPaths.length > 0
  const batch = !scenario.batch || [...successful].some(id => scenario.paths.every(path => calls.get(id)?.includes(path)))
  const passed = completed && !failed && Boolean(response.trim()) && readExpected && !readUnexpected && batch && violations === 0
    && (scenario.facts ?? []).every(fact => normalizedResponse.includes(normalizeEvaluationText(fact))) && (scenario.absent ?? []).every(fact => !normalizedResponse.includes(normalizeEvaluationText(fact)))
  return { passed, readPaths, response, violations, readExpected, readUnexpected, batch }
}
function seed(root: string, relative: string, description: string, aliases: string[], body: string): void {
  const path = join(root, relative); mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, patchMemoryMetadata(body, { name: relative.split('/').at(-1)!, description, aliases, sources: ['synthetic-evaluation'] }))
}
async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('GAMMA_MEMORY_EVAL_API_KEY=<安全注入> GAMMA_MEMORY_EVAL_MODEL=<实际模型ID> GAMMA_MEMORY_EVAL_PROVIDER=google|openai GAMMA_MEMORY_EVAL_BASE_URL=<可选> bun run apps/electron/scripts/verify-memory-retrieval.ts --output <report.json>\n默认每场景3次，共13类39次（含本轮冲突）；只使用临时合成事实，禁止文件写入和其他副作用。--check仅检查场景清单，不请求模型。')
    return
  }
  if (process.argv.includes('--check')) { console.log(JSON.stringify({ mode: 'configuration-check-only', cases: scenarios.length, repetitions: 3, total: scenarios.length * 3, modelTested: false })); return }
  const apiKey = process.env.GAMMA_MEMORY_EVAL_API_KEY
  const model = process.env.GAMMA_MEMORY_EVAL_MODEL
  const provider = process.env.GAMMA_MEMORY_EVAL_PROVIDER ?? 'google'
  if (!apiKey || !model) throw new Error('未配置模型凭据或实际模型ID；未运行模型验收。请安全注入GAMMA_MEMORY_EVAL_API_KEY和GAMMA_MEMORY_EVAL_MODEL。')
  if (provider !== 'google' && provider !== 'openai') throw new Error('验收仅支持google原生或openai兼容渠道')
  const outputIndex = process.argv.indexOf('--output')
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (!output) throw new Error('必须传 --output <report.json> 留存实际验收结果')
  // 仅给Bun提供Electron命名导出；不模拟模型或Pi生命周期，所有桌面/写工具仍被拒绝。
  await import('../../../test-preload')
  process.env.NODE_ENV = 'test'
  const results: Array<ReturnType<typeof assess> & { id: string; run: number }> = []
  for (const scenario of scenarios) for (let run = 1; run <= 3; run++) {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-evaluation-'))
    const global = join(root, 'global'); const workspace = join(root, 'workspace')
    const previousHome = setConfigHomeForTest(root)
    const { PiAgentAdapter } = await import('../src/main/lib/adapters/pi-agent-adapter')
    const adapter = new PiAgentAdapter()
    try {
      seed(global, 'preferences.md', '中文简洁表达与数字格式，调整回答方式时参考', [], '- [stated] 用中文简洁回答，数字使用阿拉伯数字。\n')
      seed(global, 'people/wang.md', '同事小王的职责与沟通方式，涉及小王交接时读取', ['小王'], '- [stated] 小王负责接口联调。\n')
      seed(global, 'topics/movies.md', '电影讨论与观影背景，询问电影口味时读取', ['电影'], '- [stated] 周末去过电影院，尚未说明偏爱的类型。\n')
      seed(global, 'topics/health.md', '健康笔记，仅用户明确涉及健康主题时读取', ['健康笔记'], '- [stated] 有高血压医疗病史。\n')
      seed(workspace, 'areas/exam.md', '秋考的科目、截止日期及未完成复习，安排秋考时读取', ['秋考'], '- [stated] 科目是微积分，截止日期11月15日，复习未完成。\n')
      seed(workspace, 'areas/handover.md', '交接时间安排，安排交接工作时读取', ['交接安排'], '- [stated] 交接安排在周四。\n')
      seed(global, 'topics/shared.md', '双域项目的全局约定，涉及双域项目时读取', ['双域项目'], '- [stated] 全局约定是中文注释。\n')
      seed(workspace, 'topics/shared.md', '双域项目的工作区约定，涉及双域项目时读取', ['双域项目'], '- [stated] 工作区约定是周五验收。\n')
      const events: SDKMessage[] = []
      for await (const event of adapter.query({ sessionId: `${scenario.id}-${run}`, prompt: scenario.query, memoryUserMessage: scenario.query, model, provider, apiKey, baseUrl: process.env.GAMMA_MEMORY_EVAL_BASE_URL, abortSignal: AbortSignal.timeout(90_000), cwd: root, piAgentDir: join(root, 'agent'), piSessionDir: join(root, 'sessions'), systemPrompt: '你是简洁的中文助手。本轮是只读回答，不执行记忆写入或其他副作用。', permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: '此合成验收只允许独立记忆读取工具，禁止其他副作用。' }), maxTurns: 12, memoryEnabled: true, memoryRoot: global, memoryWorkspaceRoot: workspace })) events.push(event)
      results.push({ id: scenario.id, run, ...assess(events, scenario) })
      console.log(`${scenario.id} #${run}: ${results.at(-1)!.passed ? '通过' : '未通过'}`)
    } catch {
      // SDK错误可能携带请求详情；不把含凭据的原始异常写入报告或日志。
      results.push({ id: scenario.id, run, passed: false, readPaths: [], response: '[运行失败或超时，未取得有效模型回答]', violations: 0, readExpected: false, readUnexpected: false, batch: false })
      console.log(`${scenario.id} #${run}: 运行失败或超时`)
    } finally { adapter.dispose(); setConfigHomeForTest(previousHome); rmSync(root, { recursive: true, force: true }) }
  }
  const expected = results.filter(result => scenarios.find(scenario => scenario.id === result.id)!.paths.length > 0)
  const unrelated = results.filter(result => scenarios.find(scenario => scenario.id === result.id)!.paths.length === 0 && !scenarios.find(scenario => scenario.id === result.id)!.optionalRead)
  const recall = expected.filter(result => result.readExpected).length / expected.length
  const falseRead = unrelated.filter(result => result.readUnexpected).length / unrelated.length
  const violations = results.reduce((total, result) => total + result.violations, 0)
  const passed = recall >= 0.9 && falseRead <= 0.1 && violations === 0 && results.every(result => result.passed)
  const report = { timestamp: new Date().toISOString(), mode: process.argv.includes('--fixture') ? 'fixture-not-model' : 'real-model', model, provider, repetitions: 3, total: results.length, recall, falseRead, violations, passed, results }
  writeTextFileAtomic(resolve(output), JSON.stringify(report, null, 2), 0o600)
  console.log(JSON.stringify({ model, total: results.length, recall, falseRead, violations, passed }))
  if (!passed) process.exitCode = 1
}
if (import.meta.main) main().catch(() => { console.error('验收未执行：请检查 --help、配置与输出路径；原始错误不输出，以免泄漏渠道凭据。'); process.exitCode = 1 })
