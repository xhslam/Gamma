import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutomaticMemoryChange } from '@gamma/shared'
import { AutomaticMemoryStore } from './automatic-memory-store'
import { AutomaticMemoryProcessor, type AutomaticMemoryJob } from './automatic-memory-processor'

describe('Claude式分类记忆的产品闭环（使用确定性模型替身）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gamma-memory-integration-'))
    mkdirSync(join(root, 'study'))
    mkdirSync(join(root, 'other'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  test('Given自然对话 When生成/改口/重开 Then同领域更新并在Chat和Agent共用的召回中生效', async () => {
    const store = new AutomaticMemoryStore({ resolveWorkspaceRoot: (slug) => join(root, slug) })
    store.updateSettings('study', { enabled: true })
    const changes: AutomaticMemoryChange[] = []
    const processor = new AutomaticMemoryProcessor({
      getSnapshot: (slug) => store.getSnapshot(slug),
      extract: async (_prompt, job) => JSON.stringify({ memories: [{ category: 'areas', title: '多元微积分', key: 'learning-progress', content: job.userText, evidence: job.userText, sensitive: false }] }),
      apply: (slug, candidates, source, text, revision) => store.applyCandidates(slug, candidates, source, text, revision),
      publish: (change) => { changes.push(change) },
    })
    const makeJob = (messageId: string, userText: string, kind: 'chat' | 'agent' = 'chat'): AutomaticMemoryJob => ({
      workspaceSlug: 'study', userText, channelId: 'fake', modelId: 'fake',
      source: { kind, sessionId: 'session', messageId, createdAt: Date.now() },
    })
    await processor.enqueue(makeJob('first', '我在学习多元微积分，已经学到偏导数。'))
    expect(changes[0]?.action).toBe('added')
    const id = store.getSnapshot('study').entries[0]!.id
    await processor.enqueue(makeJob('next', '我的多元微积分进度已到全微分。', 'agent'))
    const snapshot = store.getSnapshot('study')
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0]!.id).toBe(id)
    expect(snapshot.entries[0]!.content).toContain('全微分')
    expect(snapshot.entries[0]!.content).not.toContain('偏导数')
    expect(changes[1]?.action).toBe('updated')
    const reopened = new AutomaticMemoryStore({ resolveWorkspaceRoot: (slug) => join(root, slug) })
    expect(reopened.buildRecall('study', '继续讲多元微积分吧')).toContain('全微分')
    expect(reopened.buildRecall('other', '继续讲多元微积分吧')).toBe('')
    reopened.editEntry('study', id, '已完成多元微积分。', snapshot.revision)
    await processor.enqueue(makeJob('later', '我的多元微积分进度回到偏导数。'))
    expect(reopened.getSnapshot('study').entries[0]!.content).toBe('已完成多元微积分。')
    expect(changes).toHaveLength(2)
    const current = reopened.getSnapshot('study')
    reopened.deleteEntry('study', id, current.revision)
    await processor.enqueue(makeJob('replayed', '我在学习多元微积分，已经学到偏导数。'))
    expect(reopened.getSnapshot('study').entries).toHaveLength(0)
    expect(reopened.buildRecall('study', '多元微积分')).toBe('')
    expect(changes).toHaveLength(2)
  })
})
