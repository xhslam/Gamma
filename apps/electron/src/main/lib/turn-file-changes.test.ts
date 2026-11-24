import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { captureTurnFileEdit, TurnFileChangeStore } from './turn-file-changes'

let root: string
let store: TurnFileChangeStore
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'carpus-turn-changes-')))
  store = new TurnFileChangeStore()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function edit(id: string, path: string, text: string, sessionId = 's1') {
  await captureTurnFileEdit(root, id, path, async () => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }, (entry) => store.record(sessionId, entry))
}

describe('本轮文件变更', () => {
  test('连续编辑只统计最终差异，撤销保留本轮前改动并移除新文件', async () => {
    const file = join(root, 'a.txt')
    const created = join(root, 'nested/new.txt')
    writeFileSync(file, 'previous user change\noriginal\n')
    await edit('a', 'a.txt', 'previous user change\nintermediate\n')
    await edit('b', 'a.txt', 'previous user change\nfinal\n')
    await edit('c', 'nested/new.txt', 'added\n')
    const allowed = new Set([file, created])
    const ids = ['c', 'b', 'a']
    expect(store.summarize('s1', ids, allowed)).toMatchObject({
      canUndo: true,
      files: [{ path: file, created: false, additions: 1, deletions: 1 }, { path: created, created: true, additions: 1, deletions: 0 }],
    })
    store.undo('s1', ids, allowed)
    expect(readFileSync(file, 'utf8')).toBe('previous user change\noriginal\n')
    expect(() => readFileSync(created)).toThrow()
    expect(store.summarize('s1', ids, allowed)).toMatchObject({ undone: true, canUndo: false })
  })

  test('后续改动阻止整个撤销批次，不覆盖用户文件', async () => {
    await edit('a', 'a.txt', 'agent a\n')
    await edit('b', 'b.txt', 'agent b\n')
    const b = join(root, 'b.txt')
    writeFileSync(b, 'user edit\n')
    expect(() => store.undo('s1', ['a', 'b'], new Set([join(root, 'a.txt'), b]))).toThrow('未执行撤销')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('agent a\n')
    expect(readFileSync(b, 'utf8')).toBe('user edit\n')
  })

  test('拒绝缺失快照、跨会话记录、未授权路径以及中间插入其他轮次的改动', async () => {
    const file = join(root, 'a.txt')
    await edit('a', 'a.txt', 'agent a\n')
    await edit('other', 'a.txt', 'other session\n', 's2')
    await edit('b', 'a.txt', 'agent b\n')
    const allowed = new Set([file])
    expect(store.summarize('s1', ['a', 'b'], allowed).canUndo).toBe(false)
    expect(store.summarize('s1', ['a', 'b'], allowed).files).toEqual([{ path: file, created: false }])
    for (const [ids, scope] of [[['other'], allowed], [['b', 'missing'], allowed], [['b'], new Set<string>()]] as const) {
      expect(() => store.undo('s1', [...ids], scope)).toThrow('快照不完整')
    }
  })

  test('失败工具或符号链接不产生撤销快照；无净修改不显示文件', async () => {
    const actual = join(root, 'real.txt')
    const link = join(root, 'link.txt')
    writeFileSync(actual, 'same\n')
    symlinkSync(actual, link)
    await edit('noop', 'real.txt', 'same\n')
    await edit('symlink', 'link.txt', 'same\n')
    await expect(captureTurnFileEdit(root, 'failed', actual, async () => { throw new Error('tool failed') },
      entry => store.record('s1', entry))).rejects.toThrow('tool failed')
    expect(store.summarize('s1', ['noop', 'symlink', 'failed'], new Set([actual, link]))).toEqual({
      coveredToolIds: ['noop'], files: [], canUndo: false, undone: false,
    })
  })
})
