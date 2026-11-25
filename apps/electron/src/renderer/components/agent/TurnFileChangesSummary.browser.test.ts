import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Provider, createStore } from 'jotai'
  import { TurnFileChangesSummary } from '@/components/agent/TurnFileChangesSummary'
  import { BasePathsProvider, Message, MessageContent } from '@/components/ai-elements/message'
  import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
  import { previewFileMapAtom } from '@/atoms/preview-atoms'
  import { activeOnDemandOverlayAtom } from '@/atoms/on-demand-base-atoms'
  import '@/styles/globals.css'

  const store = createStore()
  const paths = ['src/file.ts', 'src/second.ts', 'src/third.ts', 'src/fourth.ts', 'src/' + 'longfilename'.repeat(48) + '.ts']
  const files = paths.map(path => ({ path: '/project/' + path, additions: 1, deletions: 1, created: false }))
  const result = { files, coveredToolIds: paths.map((_, i) => 'edit-' + i), canUndo: true, undone: false }
  let undone = 0
  window.electronAPI = {
    getTurnFileChanges: async request => { if (request.sessionId !== 's') throw new Error('unexpected Carpus session'); return result },
    undoTurnFileChanges: async () => { undone++; return { ...result, canUndo: false, undone: true } },
  }
  const messages = [
    { type: 'assistant', message: { content: [
      ...paths.map((path, i) => ({ type: 'tool_use', id: 'edit-' + i, name: 'Edit', input: { file_path: path } })),
      { type: 'tool_use', id: 'failed', name: 'Write', input: { file_path: 'failed.ts' } },
    ] } },
    { type: 'user', message: { content: [
      ...paths.map((_, i) => ({ type: 'tool_result', tool_use_id: 'edit-' + i })),
      { type: 'tool_result', tool_use_id: 'failed', is_error: true },
    ] } },
  ]
  const button = label => Array.from(document.querySelectorAll('button')).find(node => node.textContent.trim() === label)
  const until = async predicate => {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    throw new Error(document.body.innerText)
  }
  const h = React.createElement
  createRoot(document.getElementById('root')).render(h(Provider, { store },
    h(BasePathsProvider, { sessionId: 's', basePaths: ['/project'] },
      h('div', { className: 'flex h-[280px] min-w-0' },
        h(Conversation, null, h(ConversationContent, null,
          h(Message, { from: 'assistant' }, h(MessageContent, null,
            h('div', { id: 'answer-column' }, '任务已完成。'.repeat(60)),
            h(TurnFileChangesSummary, { basePath: '/project', turnMessages: messages })))))))))
  window.measureCardAlignment = async () => {
    await until(() => document.querySelector('[aria-label="本轮文件变更"]'))
    const card = document.querySelector('[aria-label="本轮文件变更"]')
    const output = document.getElementById('answer-column')
    const root = document.getElementById('root')
    const viewport = document.querySelector('[data-conversation-scroll-viewport]')
    return [820, 340, 240].map(width => {
      root.style.width = width + 'px'
      const cardRect = card.getBoundingClientRect()
      const outputRect = output.getBoundingClientRect()
      viewport.scrollLeft = 100
      return {
        left: Math.abs(cardRect.left - outputRect.left) < 1,
        right: Math.abs(cardRect.right - outputRect.right) < 1,
        horizontalLock: viewport.scrollWidth === viewport.clientWidth && viewport.scrollLeft === 0 && getComputedStyle(viewport).overscrollBehaviorX === 'none',
        verticalScroll: viewport.scrollHeight > viewport.clientHeight,
      }
    })
  }
  window.exercise = async () => {
    await until(() => button('撤销') && !button('撤销').disabled)
    const list = document.querySelector('section ul')
    const edited = document.body.innerText.includes('已编辑 5 个文件') && !list.innerText.includes('failed.ts')
    const card = list.closest('section')
    const lightBorder = getComputedStyle(card).borderTopColor
    document.documentElement.classList.add('dark')
    const darkBorder = getComputedStyle(card).borderTopColor
    document.documentElement.classList.remove('dark')
    const themedBorder = lightBorder !== darkBorder && getComputedStyle(card).borderTopWidth === '1px'
    button('收起文件').click()
    await until(() => button('展开文件')?.getAttribute('aria-expanded') === 'false')
    const collapsedRows = Array.from(list.children, row => row.querySelector('button').title)
    button('展开文件').click()
    await until(() => button('收起文件')?.getAttribute('aria-expanded') === 'true')
    const expandedRows = list.children.length
    list.querySelector('button').click()
    const previewPath = store.get(previewFileMapAtom).get('s')?.filePath
    store.set(activeOnDemandOverlayAtom, 'files')
    button('查看变更').click()
    const openedChanges = store.get(activeOnDemandOverlayAtom) === 'changes'
    button('查看变更').click()
    const keptChangesOpen = store.get(activeOnDemandOverlayAtom) === 'changes' && !document.querySelector('[role="dialog"]')
    button('撤销').click()
    await until(() => button('取消'))
    button('取消').click()
    await until(() => !document.querySelector('[role="alertdialog"]'))
    const cancelled = undone === 0
    button('撤销').click()
    await until(() => button('确认撤销'))
    button('确认撤销').click()
    await until(() => document.body.innerText.includes('已撤销'))
    return { edited, previewPath, openedChanges, keptChangesOpen, cancelled, undone, collapsedRows, expandedRows, themedBorder }
  }
`

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(fixture) }, 180_000)
afterAll(async () => { await renderer?.dispose() })

test('任务完成后查看变更打开右上角改动，重复点击保持打开，且不影响文件预览和撤销', async () => {
  expect(await renderer.run<{ edited: boolean; previewPath: string; openedChanges: boolean; keptChangesOpen: boolean; cancelled: boolean; undone: number; collapsedRows: string[]; expandedRows: number; themedBorder: boolean }>('return await window.exercise()')).toEqual({
    edited: true, previewPath: '/project/src/file.ts', openedChanges: true, keptChangesOpen: true, cancelled: true, undone: 1,
    collapsedRows: ['查看文件：src/file.ts', '查看文件：src/second.ts', '查看文件：src/third.ts'],
    expandedRows: 5, themedBorder: true,
  })
}, 30_000)


test('宽窄对话列中卡片与正文对齐，长文件名不会使对话横向滚动', async () => {
  const alignment = await renderer.run<Array<{ left: boolean; right: boolean; horizontalLock: boolean; verticalScroll: boolean }>>('return await window.measureCardAlignment()')
  expect(alignment).toEqual(Array(3).fill({ left: true, right: true, horizontalLock: true, verticalScroll: true }))
}, 30_000)
