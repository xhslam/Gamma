import { describe, expect, it } from 'bun:test'
import type { AgentContextRef } from '@gamma/shared'
import { reconcileReferenceSummaries } from './background-summary'
import type { BackgroundSummaryDeps } from './background-summary'

const ref: AgentContextRef = { refId: 'background_ref', sourceConversationId: 'background_source', sourceProjectId: 'fixture', titleAtAttach: 'fixture', mode: 'live' }
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
function fixture(): BackgroundSummaryDeps {
  return { namespace: crypto.randomUUID(), getMessages: () => [{ id: 'm', role: 'user', content: 'fixture' }], loadSummary: () => null }
}

describe('Given 附加时后台摘要', () => {
  it('When模型未响应 Then附加立即返回摘要中且相同任务不重复启动', async () => {
    let finish: (text: string | null) => void = () => {}
    let calls = 0
    const deps = { ...fixture(), generate: () => { calls++; return new Promise<string | null>((resolve) => { finish = resolve }) } }
    expect(reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)[ref.refId]).toBe('running')
    expect(calls).toBe(0)
    await tick()
    expect(calls).toBe(1)
    expect(reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)[ref.refId]).toBe('running')
    expect(calls).toBe(1)
    finish('ready summary')
    await tick()
    expect(reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)[ref.refId]).toBe('ready')
  })
  it('When模型失败 Then标记失败回退而不抛出或泄漏异常正文', async () => {
    const deps = { ...fixture(), generate: async () => { throw new Error('secret-fixture-body') } }
    reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)
    await tick()
    expect(reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)[ref.refId]).toBe('fallback')
  })
  it('When移除或内容改变 Then取消旧任务且旧结果不覆盖新任务', async () => {
    let content = 'old'
    const pending: Array<{ signal: AbortSignal | undefined; finish: (text: string) => void }> = []
    const deps: BackgroundSummaryDeps = { ...fixture(), getMessages: () => [{ id: 'm', role: 'user', content }], generate: (input) => new Promise((finish) => pending.push({ signal: input.signal, finish })) }
    reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)
    await tick()
    content = 'edited'
    reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)
    await tick()
    expect(pending[0]!.signal?.aborted).toBe(true)
    pending[0]!.finish('stale')
    await tick()
    expect(reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)[ref.refId]).toBe('running')
    expect(reconcileReferenceSummaries('target', [], 'c', 'm', deps)).toEqual({})
    expect(pending[1]!.signal?.aborted).toBe(true)
    pending[1]!.finish('removed')
    await tick()
  })
  it('When重开且持久摘要已命中 Then直接就绪并不重新生成', () => {
    let generated = false
    const deps = { ...fixture(), loadSummary: () => 'persisted summary', generate: async () => { generated = true; return null } }
    expect(reconcileReferenceSummaries('target', [ref], 'c', 'm', deps)[ref.refId]).toBe('ready')
    expect(generated).toBe(false)
  })
})
