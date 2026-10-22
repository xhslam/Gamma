import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

/**
 * 真实 Chromium 验证代码审查改动列表的可见行虚拟化。
 * 只使用内存中的合成改动，不读取用户仓库、不连接 Git 或模型。
 */
const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Provider, createStore } from 'jotai'
  import { TooltipProvider } from '@/components/ui/tooltip'
  import { DiffChangesList } from '@/components/diff/DiffChangesList'
  import {
    agentSelectedWorktreeAtom, agentSessionsAtom, agentDiffDataAtom,
    agentDiffUnseenFilesAtom, agentNonGitFileChangesAtom,
  } from '@/atoms/agent-atoms'
  import '@/styles/globals.css'

  document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0}</style>')
  const errors = []
  window.addEventListener('error', event => errors.push(event.message))
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
  const delay = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async predicate => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; if (errors.length) throw new Error(errors.join('; ')); await delay(10) }
    throw new Error('改动列表未达到预期：' + document.body.innerText.slice(0, 800))
  }

  let files = []
  const opened = [], reverted = []
  window.electronAPI = {
    getUnstagedChanges: async () => ({ isGitRepo: true, files, untrackedFiles: [], gitRootNames: ['proj'] }),
    getDiffContents: async () => ({ oldContent: 'old\n', newContent: 'new\n' }),
    showInFolder: async () => {},
    revertFile: async input => { reverted.push(input) },
    filterExistingFilePaths: async paths => paths,
  }

  const store = createStore()
  store.set(agentSessionsAtom, [])
  store.set(agentSelectedWorktreeAtom, new Map())
  store.set(agentDiffDataAtom, new Map())
  store.set(agentDiffUnseenFilesAtom, new Map())
  store.set(agentNonGitFileChangesAtom, new Map())
  const root = createRoot(document.getElementById('root'))

  window.diffListTest = {
    errors, opened, reverted, until, delay,
    async mount(count) {
      files = Array.from({ length: count }, (_, i) => ({
        filePath: 'src/group-0/file-' + i + '.ts',
        status: 'modified', additions: 4, deletions: 2, gitRoot: 'C:/proj', source: 'project',
      }))
      root.render(React.createElement(Provider, { store }, React.createElement(TooltipProvider, { delayDuration: 0 },
        React.createElement(DiffChangesList, {
          dirPath: 'C:/proj', projectName: '项目', sessionId: 's1', sessionPath: 'C:/proj',
          onFileClick: (filePath, isUntracked, gitRoot) => opened.push({ filePath, isUntracked, gitRoot }),
        }))))
      await until(() => document.querySelectorAll('[role="button"][class*="group/file"]').length > 0)
      await delay(60)
    },
    rowCount: () => document.querySelectorAll('[role="button"][class*="group/file"]').length,
    scroller: () => document.querySelector('[data-testid="diff-changes-scroll"]'),
    listHeight: () => document.querySelector('[data-testid="diff-changes-virtual-list"]').getBoundingClientRect().height,
    async scrollToBottom(expectedText) {
      // 滚动事件与虚拟化重算可能跨帧到达；轮询到末行真正挂载再断言。
      for (let attempt = 0; attempt < 20; attempt++) {
        const scroller = document.querySelector('[data-testid="diff-changes-scroll"]')
        scroller.scrollTop = scroller.scrollHeight
        await delay(50)
        if (!expectedText || document.body.innerText.includes(expectedText)) return
      }
    },
    async clickFirstFile() {
      document.querySelector('[role="button"][class*="group/file"]').click()
      await delay(40)
    },
    async toggleDirectory() {
      const button = [...document.querySelectorAll('button[aria-expanded]')].find(node => node.getAttribute('aria-expanded') === 'true')
      if (!button) throw new Error('找不到可折叠目录')
      button.click()
      await delay(80)
    },
    async search(value) {
      const input = document.querySelector('input[aria-label="搜索改动文件"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await delay(120)
    },
    text: () => document.body.innerText,
  }
`

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(fixtureSource) }, 180_000)
afterAll(async () => { await renderer?.dispose() })

describe('代码审查改动列表', () => {
  test('Given 1200 个改动文件 When 打开列表 Then 只挂载视口附近的行且滚动到底能看到最后一个文件', async () => {
    const result = await renderer.run<{ rendered: number; listHeight: number; bottomVisible: boolean; errors: string[] }>(`
      const api = window.diffListTest
      await api.mount(1200)
      const rendered = api.rowCount()
      const listHeight = api.listHeight()
      const scroller = api.scroller()
      const before = { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight }
      await api.scrollToBottom('file-1199.ts')
      const after = { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, rows: api.rowCount() }
      return { rendered, listHeight, before, after, tail: api.text().slice(-300), bottomVisible: api.text().includes('file-1199.ts'), errors: api.errors }
    `)
    expect(result.errors).toEqual([])
    expect(result.rendered).toBeLessThan(80)
    expect(result.listHeight).toBeGreaterThan(30_000)
    expect(result.bottomVisible).toBe(true)
  }, 60_000)

  test('Given 虚拟化后的改动行 When 点击第一个文件 Then 仍回传原始路径和仓库归属', async () => {
    const result = await renderer.run<{ opened: Array<{ filePath: string; isUntracked: boolean; gitRoot: string }>; errors: string[] }>(`
      const api = window.diffListTest
      api.opened.length = 0
      await api.mount(40)
      await api.clickFirstFile()
      return { opened: api.opened, errors: api.errors }
    `)
    expect(result.errors).toEqual([])
    expect(result.opened[0]).toMatchObject({ filePath: expect.stringContaining('file-'), isUntracked: false, gitRoot: 'C:/proj' })
  }, 60_000)

  test('Given 目录展开且文件很多 When 折叠目录或输入搜索 Then 行数与命中结果同步收缩', async () => {
    const result = await renderer.run<{ expanded: number; collapsed: number; searched: number; searchText: boolean; errors: string[] }>(`
      const api = window.diffListTest
      await api.mount(600)
      const expanded = api.rowCount()
      await api.toggleDirectory()
      const collapsed = api.rowCount()
      await api.search('file-599')
      const searched = api.rowCount()
      return { expanded, collapsed, searched, searchText: api.text().includes('file-599.ts'), errors: api.errors }
    `)
    expect(result.errors).toEqual([])
    expect(result.expanded).toBeLessThan(80)
    expect(result.collapsed).toBeLessThan(result.expanded)
    expect(result.searchText).toBe(true)
  }, 60_000)
})
