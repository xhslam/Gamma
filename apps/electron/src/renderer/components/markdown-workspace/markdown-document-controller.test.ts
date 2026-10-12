import { describe, expect, test } from 'bun:test'
import type { MarkdownWorkspaceDocument } from '@gamma/shared'
import { acceptLoadedDocument, beginDocumentLoad, completeDocumentSave, editDocument, initialMarkdownWorkspaceState } from './markdown-document-controller'
const document = (id: string): MarkdownWorkspaceDocument => ({ id, sourceId: 'source', name: id + '.md', path: id, content: '# ' + id, revision: 'r1', writable: true, sourceOnly: false })
describe('Given 按文档隔离的 Markdown 草稿', () => {
  test('When 未指定视图打开普通文档 Then 默认富文本与解锁', () => {
    const state = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', document('A'))
    expect(state.documents.A).toMatchObject({ mode: 'rich', editing: true })
  })
  test('When 首次打开选择富文本默认视图 Then 可写文档解锁且只读文档保持锁定', () => {
    const editable = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', document('A'), 'rich')
    const readonly = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', { ...document('A'), writable: false }, 'rich')
    const large = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', { ...document('A'), sourceOnly: true }, 'rich')
    expect(editable.documents.A).toMatchObject({ mode: 'rich', editing: true })
    expect(readonly.documents.A).toMatchObject({ mode: 'rich', editing: false })
    expect(large.documents.A).toMatchObject({ mode: 'source', editing: false })
  })
  test('When 修改默认视图后再次打开已有文档 Then 保留该文档的视图与草稿', () => {
    let state = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', document('A'), 'split')
    state = editDocument(state, 'A', '未保存草稿')
    state = acceptLoadedDocument(beginDocumentLoad(state, 'A'), 'A', document('A'), 'rich')
    expect(state.documents.A).toMatchObject({ mode: 'split', editing: false, draft: '未保存草稿' })
  })
  test('When 文件只能以源码打开 Then 初始视图与只读状态保持一致', () => {
    const state = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'large'), 'large', { ...document('large'), sourceOnly: true })
    expect(state.documents.large).toMatchObject({ mode: 'source', editing: false, sourceOnly: true })
  })
  test('When A 的读取晚于 B Then 不抢走当前文档', () => {
    let state = beginDocumentLoad(initialMarkdownWorkspaceState(), 'A')
    state = beginDocumentLoad(state, 'B')
    state = acceptLoadedDocument(state, 'B', document('B'))
    state = acceptLoadedDocument(state, 'A', document('A'))
    expect(state.activeId).toBe('B')
    expect(state.documents.A?.draft).toBe('# A')
  })
  test('When 两个文档切换或重读 Then 保留各自未保存草稿', () => {
    let state = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', document('A'))
    state = editDocument(state, 'A', 'A 草稿')
    state = acceptLoadedDocument(beginDocumentLoad(state, 'B'), 'B', document('B'))
    state = editDocument(state, 'B', 'B 草稿')
    state = acceptLoadedDocument(beginDocumentLoad(state, 'A'), 'A', { ...document('A'), content: '磁盘' })
    expect(state.documents.A?.draft).toBe('A 草稿')
    expect(state.documents.B?.draft).toBe('B 草稿')
  })
  test('When 保存期间继续输入 Then 仅提交快照成为 savedContent', () => {
    let state = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', document('A'))
    state = editDocument(state, 'A', '提交快照')
    state = editDocument(state, 'A', '继续输入')
    state = completeDocumentSave(state, 'A', { status: 'saved', document: { ...document('A'), content: '提交快照', revision: 'r2' } })
    expect(state.documents.A).toMatchObject({ draft: '继续输入', savedContent: '提交快照', revision: 'r2' })
  })
  test('When 保存冲突 Then 草稿保留并记录错误', () => {
    let state = acceptLoadedDocument(beginDocumentLoad(initialMarkdownWorkspaceState(), 'A'), 'A', document('A'))
    state = editDocument(state, 'A', '我的草稿')
    state = completeDocumentSave(state, 'A', { status: 'error', code: 'conflict', message: '外部变化' })
    expect(state.documents.A).toMatchObject({ draft: '我的草稿', revision: 'r1', error: '外部变化', conflict: true })
  })
  test('When 不同工作区初始化 Then 状态不共享', () => {
    const first = editDocument(acceptLoadedDocument(initialMarkdownWorkspaceState(), '', document('A')), 'A', '草稿')
    expect(first.documents.A?.draft).toBe('草稿')
    expect(initialMarkdownWorkspaceState().documents).toEqual({})
  })
  test('When 创建未命名文档 Then 生成草稿、Tab 并激活', () => {
    const state = initialMarkdownWorkspaceState()
    const { createUntitledDocument, closeDocumentTab, removeWorkspaceSource, setWorkspaceSources, addWorkspaceSource } = require('./markdown-document-controller')
    const next = createUntitledDocument(state, 'rich')
    expect(next.tabs.length).toBe(1)
    expect(next.activeId).toBe(next.tabs[0])
    expect(next.documents[next.activeId!].name).toBe('Untitled-1.md')
    expect(next.documents[next.activeId!].editing).toBe(true)

    // 再次创建未命名文档自动递增序号
    const second = createUntitledDocument(next, 'rich')
    expect(second.tabs.length).toBe(2)
    expect(second.documents[second.activeId!].name).toBe('Untitled-2.md')

    // 关闭 Tab
    const closed = closeDocumentTab(second, second.activeId!)
    expect(closed.tabs.length).toBe(1)
    expect(closed.activeId).toBe(next.tabs[0])
  })

  test('When 移除工作区来源 Then 自动清理其关联文档 Tab 并调整激活文档', () => {
    const { removeWorkspaceSource, setWorkspaceSources, acceptLoadedDocument, beginDocumentLoad } = require('./markdown-document-controller')
    let state = initialMarkdownWorkspaceState()
    state = setWorkspaceSources(state, [
      { id: 'src-1', name: 'docs', kind: 'directory' },
      { id: 'src-2', name: 'notes', kind: 'directory' },
    ])
    state = acceptLoadedDocument(beginDocumentLoad(state, 'k1'), 'k1', { id: 'doc-1', sourceId: 'src-1', name: 'guide.md', path: 'guide.md', content: 'abc', revision: 'r1', writable: true, sourceOnly: false })
    state = acceptLoadedDocument(beginDocumentLoad(state, 'k2'), 'k2', { id: 'doc-2', sourceId: 'src-2', name: 'memo.md', path: 'memo.md', content: 'def', revision: 'r2', writable: true, sourceOnly: false })
    expect(state.tabs).toEqual(['doc-1', 'doc-2'])
    expect(state.activeId).toBe('doc-2')

    // 移除 src-2
    const pruned = removeWorkspaceSource(state, 'src-2')
    expect(pruned.sources.map((s: { id: string }) => s.id)).toEqual(['src-1'])
    expect(pruned.tabs).toEqual(['doc-1'])
    expect(pruned.activeId).toBe('doc-1')
  })
})
