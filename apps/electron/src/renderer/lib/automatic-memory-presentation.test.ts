import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AutomaticMemoryChange, AutomaticMemoryEntry } from '@gamma/shared'
import { AUTOMATIC_MEMORY_IPC_CHANNELS } from '@gamma/shared'
import { readFileSync } from 'node:fs'
import { automaticMemoryChangesAtom, automaticMemoryNavigationAtom, automaticMemoryPanelStateAtomFamily } from '../atoms/automatic-memory-atoms'
import { appendAutomaticMemoryChange, AUTOMATIC_MEMORY_CATEGORIES, filterAutomaticMemoryEntries, selectAutomaticMemoryChanges } from './automatic-memory-presentation'

function change(patch: Partial<AutomaticMemoryChange> = {}): AutomaticMemoryChange {
  return { workspaceSlug: 'project', source: { kind: 'chat', sessionId: 'session', messageId: 'message', createdAt: 1 }, entryId: 'entry', title: '偏好', category: 'profile', action: 'added', changedAt: 2, ...patch }
}

describe('Given 当前运行期的真实自动记忆提交事件', () => {
  test('When 写入真实变更并点击 Then Jotai 状态保留提示并导航到对应工作区条目', () => {
    const store = createStore()
    expect(store.get(automaticMemoryChangesAtom)).toEqual([])
    const saved = change()
    store.set(automaticMemoryChangesAtom, (previous) => appendAutomaticMemoryChange(previous, saved))
    expect(selectAutomaticMemoryChanges(store.get(automaticMemoryChangesAtom), 'chat', 'session')).toEqual([saved])
    store.set(automaticMemoryNavigationAtom, { workspaceSlug: saved.workspaceSlug, entryId: saved.entryId })
    expect(store.get(automaticMemoryNavigationAtom)).toEqual({ workspaceSlug: 'project', entryId: 'entry' })
  })
  test('When 重复广播 Then 不重复展示且保留不同消息的真实更新', () => {
    const saved = change()
    const original = [saved]
    expect(appendAutomaticMemoryChange(original, structuredClone(saved))).toBe(original)
    const updated = change({ action: 'updated', source: { ...saved.source, messageId: 'next' } })
    expect(appendAutomaticMemoryChange(original, updated)).toHaveLength(2)
  })
  test('When kind、会话或工作区不一致 Then 不串会话', () => {
    const saved = change()
    const events = [saved, change({ workspaceSlug: 'other' }), change({ source: { ...saved.source, kind: 'agent' } }), change({ source: { ...saved.source, sessionId: 'other' } })]
    expect(selectAutomaticMemoryChanges(events, 'chat', 'session', 'project')).toEqual([saved])
    expect(selectAutomaticMemoryChanges(events, 'agent', 'missing')).toEqual([])
  })
  test('When 超出展示容量 Then 仅显示最近 8 条并限制内存缓存为 100 条', () => {
    let events: AutomaticMemoryChange[] = []
    for (let index = 0; index < 110; index++) events = appendAutomaticMemoryChange(events, change({ changedAt: index }))
    expect(events).toHaveLength(100)
    expect(selectAutomaticMemoryChanges(events, 'chat', 'session').map((item) => item.changedAt)).toEqual([102, 103, 104, 105, 106, 107, 108, 109])
  })
  test('When 渲染分类 Then 四类契约稳定且无遗漏', () => {
    expect(AUTOMATIC_MEMORY_CATEGORIES.map((item) => item.key)).toEqual(['profile', 'topics', 'areas', 'people'])
  })
})

describe('Given 工作区记忆浏览状态', () => {
  test('When 搜索标题或正文 Then 忽略首尾空格与大小写，不修改原始条目', () => {
    const entries: AutomaticMemoryEntry[] = [
      { id: 'a', category: 'profile', title: 'Gamma UI', content: '喜欢紧凑布局', facts: [], revision: 1, createdAt: 1, updatedAt: 2, manuallyEdited: false },
      { id: 'b', category: 'areas', title: '工程约定', content: '使用 Bun', facts: [], revision: 1, createdAt: 1, updatedAt: 2, manuallyEdited: true },
    ]
    expect(filterAutomaticMemoryEntries(entries, ' gamma ')).toEqual(entries.slice(0, 1))
    expect(filterAutomaticMemoryEntries(entries, '紧凑')).toEqual(entries.slice(0, 1))
    expect(filterAutomaticMemoryEntries(entries, 'BUN')).toEqual(entries.slice(1, 2))
    expect(filterAutomaticMemoryEntries(entries, 'missing')).toEqual([])
    expect(filterAutomaticMemoryEntries(entries, '  ')).toBe(entries)
    expect(entries).toHaveLength(2)
  })
  test('When 切换工作区或重开面板 Then 浏览状态在当前工作区保留但不会串到其他工作区', () => {
    const store = createStore()
    const first = automaticMemoryPanelStateAtomFamily('first')
    const second = automaticMemoryPanelStateAtomFamily('second')
    store.set(first, (previous) => ({ ...previous, open: false, query: '界面', expandedEntries: ['a'], collapsedCategories: ['people'] }))
    expect(store.get(automaticMemoryPanelStateAtomFamily('first'))).toEqual({ open: false, settingsOpen: false, query: '界面', expandedEntries: ['a'], collapsedCategories: ['people'] })
    expect(store.get(second)).toEqual({ open: true, settingsOpen: false, query: '', expandedEntries: [], collapsedCategories: [] })
  })
})

describe('Given 分类记忆四层 IPC 契约', () => {
  const main = readFileSync(new URL('../../main/ipc.ts', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../../preload/index.ts', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../components/agent-skills/AutomaticMemoryPanel.tsx', import.meta.url), 'utf8')
  test('When renderer 调用 CRUD Then 主进程和 bridge 使用共享通道及同名 store API', () => {
    for (const [channel, method] of [['GET', 'getAutomaticMemorySnapshot'], ['SETTINGS', 'updateAutomaticMemorySettings'], ['EDIT', 'editAutomaticMemoryEntry'], ['DELETE', 'deleteAutomaticMemoryEntry']] as const) {
      expect(AUTOMATIC_MEMORY_IPC_CHANNELS[channel]).toStartWith('automatic-memory:')
      expect(main).toContain(`ipcMain.handle(AUTOMATIC_MEMORY_IPC_CHANNELS.${channel}`)
      expect(main).toContain(method)
      expect(preload).toContain(`${method}:`)
      expect(preload).toContain(`ipcRenderer.invoke(AUTOMATIC_MEMORY_IPC_CHANNELS.${channel}`)
      expect(panel).toContain(`window.electronAPI.${method}`)
    }
  })
  test('When 取消 CHANGED 订阅 Then 正确移除同一 listener', () => {
    expect(preload).toContain('ipcRenderer.on(AUTOMATIC_MEMORY_IPC_CHANNELS.CHANGED, listener)')
    expect(preload).toContain('ipcRenderer.removeListener(AUTOMATIC_MEMORY_IPC_CHANNELS.CHANGED, listener)')
  })
  test('When 用户编辑或确认删除 Then 捕获快照 revision 而非条目 revision', () => {
    expect(panel).toContain('setEditRevision(snapshot.revision)')
    expect(panel).toContain('setDeleteRevision(snapshot.revision)')
    expect(panel).toContain('text, editRevision)')
    expect(panel).toContain('deleting.id, deleteRevision)')
    expect(panel).not.toContain('text, editing.revision)')
  })
})
