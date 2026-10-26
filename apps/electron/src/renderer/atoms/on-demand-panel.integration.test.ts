import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentDiffPanelTabAtom, agentSidePanelOpenMapAtom, currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom, getPreviewSidePanelTab, openWorkspaceComponentAtom } from './agent-atoms'
import { activeOnDemandOverlayAtom, openInBigPanelAtom, toggleOnDemandOverlayAtom } from './on-demand-panel-atoms'
import { getPreviewFileId, previewFileMapAtom, previewFilesMapAtom } from './preview-atoms'
import type { PreviewFile } from './preview-atoms'
import { openPreviewInStore } from '../components/diff/preview-opener'

function createFixture() {
  const store = createStore()
  store.set(agentSidePanelOpenMapAtom, {})
  store.set(currentAgentSessionIdAtom, 'acceptance-session')
  return store
}

describe('Given 实际 Jotai store 与既有预览入口，而非独立状态机演示', () => {
  test('When 文件浮层选择具体文件 Then 真正创建文件预览并关闭浮层', () => {
    const store = createFixture()
    const file: PreviewFile = { filePath: '/project/src/index.ts', previewOnly: true, readOnly: true }
    store.set(toggleOnDemandOverlayAtom, 'files')
    store.set(openInBigPanelAtom, { tab: 'files', target: file })

    expect(store.get(previewFileMapAtom).get('acceptance-session')).toEqual(file)
    expect(store.get(previewFilesMapAtom).get('acceptance-session')).toEqual([file])
    expect(store.get(agentDiffPanelTabAtom).get('acceptance-session')).toBe(getPreviewSidePanelTab(getPreviewFileId(file)))
    expect(store.get(currentSessionSidePanelOpenAtom)).toBe(true)
    expect(store.get(activeOnDemandOverlayAtom)).toBe(null)
  })

  test('When 改动浮层选择含仓库归属的文件 Then diff 目标的 gitRoot 与 baseRef 不丢失', () => {
    const store = createFixture()
    const file: PreviewFile = { filePath: 'src/index.ts', dirPath: '/worktree', gitRoot: '/worktree', baseRef: 'origin/main' }
    store.set(toggleOnDemandOverlayAtom, 'changes')
    store.set(openInBigPanelAtom, { tab: 'changes', target: file })

    expect(store.get(previewFileMapAtom).get('acceptance-session')).toEqual(file)
    expect(store.get(agentDiffPanelTabAtom).get('acceptance-session')).toBe(getPreviewSidePanelTab(getPreviewFileId(file)))
    expect(store.get(activeOnDemandOverlayAtom)).toBe(null)
  })

  test('When 聊天文件链接调用原有 openPreviewInStore Then 大面板打开且 S1 同步关闭', () => {
    const store = createFixture()
    store.set(toggleOnDemandOverlayAtom, 'files')
    openPreviewInStore(store, 'acceptance-session', { filePath: '/project/notes.md', previewOnly: true })

    expect(store.get(currentSessionSidePanelOpenAtom)).toBe(true)
    expect(store.get(activeOnDemandOverlayAtom)).toBe(null)
    expect(store.get(previewFileMapAtom).get('acceptance-session')?.filePath).toBe('/project/notes.md')
  })

  test('When 既有组件入口打开工作区 Then 不会残留与 S2 并存的 S1', () => {
    const store = createFixture()
    store.set(toggleOnDemandOverlayAtom, 'changes')
    store.set(openWorkspaceComponentAtom, 'markdown')

    expect(store.get(currentSessionSidePanelOpenAtom)).toBe(true)
    expect(store.get(activeOnDemandOverlayAtom)).toBe(null)
  })
})
