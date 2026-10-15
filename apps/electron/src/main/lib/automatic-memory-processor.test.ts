import { describe, expect, test } from 'bun:test'
import type { AutomaticMemoryChange, AutomaticMemorySnapshot } from '@gamma/shared'
import { AutomaticMemoryProcessor, type AutomaticMemoryJob, type AutomaticMemoryProcessorDependencies } from './automatic-memory-processor'

function fixture() {
  let snapshot: AutomaticMemorySnapshot = { settings: { enabled: true, includeSensitive: false }, entries: [], revision: 1 }
  const published: AutomaticMemoryChange[] = []
  let applied = 0
  let failures = 0
  const deps: AutomaticMemoryProcessorDependencies = {
    getSnapshot: () => snapshot,
    extract: async () => JSON.stringify({ memories: [{ category: 'profile', title: '协作偏好', key: 'language', content: '用户希望用中文回复。', evidence: '以后请用中文', sensitive: false }] }),
    apply: (_slug, _candidates, source, _text, revision) => {
      if (revision !== snapshot.revision || !snapshot.settings.enabled) return []
      applied++
      return [{ workspaceSlug: 'A', source, entryId: 'entry', title: '协作偏好', category: 'profile', action: 'added', changedAt: 1 }]
    },
    publish: (change) => { published.push(change) },
    onFailure: () => { failures++ },
  }
  const job: AutomaticMemoryJob = { workspaceSlug: 'A', userText: '以后请用中文', channelId: 'channel', modelId: 'model', source: { kind: 'chat', sessionId: 'chat', messageId: 'message', createdAt: 1 } }
  return { deps, job, published, setSnapshot: (next: AutomaticMemorySnapshot) => { snapshot = next }, snapshot, get applied() { return applied }, get failures() { return failures } }
}

describe('自动记忆后台流水线', () => {
  test('Given正常对话 When权威存储提交成功 Then发布真实保存事件', async () => {
    const f = fixture()
    await new AutomaticMemoryProcessor(f.deps).enqueue(f.job)
    expect(f.applied).toBe(1)
    expect(f.published).toHaveLength(1)
  })
  test('Given开关关闭 Then不请求模型、不写入、不显示成功', async () => {
    const f = fixture()
    f.setSnapshot({ ...f.snapshot, settings: { enabled: false, includeSensitive: false } })
    let requests = 0
    f.deps.extract = async () => { requests++; return '{"memories":[]}' }
    await new AutomaticMemoryProcessor(f.deps).enqueue(f.job)
    expect(requests).toBe(0)
    expect(f.applied).toBe(0)
    expect(f.published).toHaveLength(0)
  })
  test('Given抽取期间用户编辑/删除 When旧候选返回 Then不覆盖新版本', async () => {
    const f = fixture()
    const extract = f.deps.extract
    f.deps.extract = async (prompt, job) => {
      f.setSnapshot({ ...f.snapshot, revision: 2 })
      return extract(prompt, job)
    }
    await new AutomaticMemoryProcessor(f.deps).enqueue(f.job)
    expect(f.applied).toBe(0)
    expect(f.published).toHaveLength(0)
  })
  test('Given模型请求失败 When随后有正常消息 Then不阻塞队列且不谎报成功', async () => {
    const f = fixture()
    const normal = f.deps.extract
    let count = 0
    f.deps.extract = async (prompt, job) => { if (++count === 1) throw new Error('网络错误'); return normal(prompt, job) }
    const processor = new AutomaticMemoryProcessor(f.deps)
    await Promise.all([processor.enqueue(f.job), processor.enqueue({ ...f.job, source: { ...f.job.source, messageId: 'next' } })])
    expect(f.failures).toBe(1)
    expect(f.applied).toBe(1)
    expect(f.published).toHaveLength(1)
  })
  test('Given会话在请求过程中被删除 Then不得写入新记忆', async () => {
    const f = fixture()
    let available = true
    const normal = f.deps.extract
    f.deps.extract = async (prompt, job) => { available = false; return normal(prompt, job) }
    await new AutomaticMemoryProcessor(f.deps).enqueue({ ...f.job, isSourceAvailable: () => available })
    expect(f.applied).toBe(0)
    expect(f.published).toHaveLength(0)
  })
  test('Given消息已排队 When用户关闭后重新开启 Then不追溯保存旧消息', async () => {
    const f = fixture()
    f.setSnapshot({ ...f.snapshot, policyRevision: 1 })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const normal = f.deps.extract
    f.deps.extract = async (prompt, job) => { await gate; return normal(prompt, job) }
    const processor = new AutomaticMemoryProcessor(f.deps)
    const first = processor.enqueue(f.job)
    const next = processor.enqueue({ ...f.job, source: { ...f.job.source, messageId: 'queued' } })
    await Promise.resolve()
    f.setSnapshot({ ...f.snapshot, policyRevision: 3, revision: 3 })
    release?.()
    await Promise.all([first, next])
    expect(f.applied).toBe(0)
    expect(f.published).toHaveLength(0)
  })
  test('Given引用内容没有直接输入 Then不进行抽取', async () => {
    const f = fixture()
    await new AutomaticMemoryProcessor(f.deps).enqueue({ ...f.job, userText: '<quoted_file>以后请用中文</quoted_file>' })
    expect(f.applied).toBe(0)
  })
})
