import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../../test-utils/visual-renderer'

// 截图输出目录：环境变量优先，默认使用系统临时目录，自动 mkdir -p
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || join(tmpdir(), 'gamma-artifacts-right-panel')
try {
  mkdirSync(ARTIFACTS_DIR, { recursive: true })
} catch {}

const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Provider, createStore } from 'jotai'
  import { TooltipProvider } from '@/components/ui/tooltip'
  import { AgentHeader } from '@/components/agent/AgentHeader'
  import { RightSidePanel } from '@/components/app-shell/RightSidePanel'
  import {
    agentSessionsAtom,
    currentAgentSessionIdAtom,
    currentAgentWorkspaceIdAtom,
    agentWorkspacesAtom,
    agentSessionPathMapAtom,
    agentDiffDataAtom,
    agentNonGitFileChangesAtom,
    agentSelectedWorktreeAtom,
    agentSidePanelOpenAtomFamily,
    currentSessionSidePanelOpenAtom,
    agentSideTemporaryAgentMapAtom,
    agentDiffPanelTabAtom,
    agentAttachedFilesMapAtom,
    agentAttachedDirectoriesMapAtom,
    agentSidePanelLayoutAtomFamily,
    workspaceFilesVersionAtom,
    workspaceGitDiffRefreshVersionAtom,
    agentDiffRefreshVersionAtom,
  } from '@/atoms/agent-atoms'
  import {
    activeOnDemandOverlayAtom,
    openInBigPanelAtom,
    toggleOnDemandOverlayAtom,
    closeOnDemandOverlayAtom,
    agentDiffStatusAtom,
  } from '@/atoms/on-demand-panel-atoms'
  import { previewFileMapAtom, previewFilesMapAtom, previewPanelOpenMapAtom } from '@/atoms/preview-atoms'
  import '@/styles/globals.css'

  document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0;overflow:hidden;}</style>')
  const errors = []
  window.addEventListener('error', (event) => errors.push(event.message))
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  const delay = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (predicate) => {
    for (let i = 0; i < 250; i++) {
      if (predicate()) return
      if (errors.length) throw new Error(errors.join('; '))
      await delay(20)
    }
    throw new Error('断言超时，当前内容：' + document.body.innerText.slice(0, 600))
  }

  const store = createStore()
  const sessionId = 'session-test-1'

  // 初始化真实基础状态
  store.set(currentAgentSessionIdAtom, sessionId)
  store.set(currentAgentWorkspaceIdAtom, 'ws-1')
  store.set(agentWorkspacesAtom, [
    { id: 'ws-1', name: 'Gamma', slug: 'gamma', projectRootPath: '/workspace/gamma', path: '/workspace/gamma' }
  ])
  store.set(agentSessionPathMapAtom, new Map([[sessionId, '/workspace/gamma']]))
  store.set(agentSidePanelLayoutAtomFamily(sessionId), {
    width: 460,
    hasOpenedWideWorkspace: false,
    widePanelWidthOverride: null,
    workspaceSide: 'right',
  })
  store.set(agentSessionsAtom, [
    {
      id: sessionId,
      title: '按需右侧面板演示',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 60000,
    },
    {
      id: 'branch-1',
      title: '调研分支：状态机重构',
      explorationParentSessionId: sessionId,
      explorationSourceMessageId: 'msg-root',
      explorationSourceLabel: '重构阶段',
      createdAt: Date.now() - 1800000,
      updatedAt: Date.now() - 120000,
    },
    {
      id: 'branch-2',
      title: '调研分支：性能调优',
      explorationParentSessionId: sessionId,
      explorationSourceMessageId: 'msg-perf',
      explorationSourceLabel: '性能阶段',
      createdAt: Date.now() - 900000,
      updatedAt: Date.now() - 30000,
    },
  ])

  // 活跃调研分支 (严格基于 agentSideTemporaryAgentMapAtom)
  store.set(agentSideTemporaryAgentMapAtom, new Map([
    [sessionId, [
      {
        sessionId: 'branch-1',
        sourceMessageId: 'msg-root',
        sourceLabel: '重构阶段',
      }
    ]]
  ]))

  // 初始化改动数据缓存 (使用 sessionId:session 统一键，无猜测回退)
  const initialDiff = {
    isGitRepo: true,
    files: [
      { filePath: 'src/index.ts', additions: 15, deletions: 3, gitRoot: '/workspace/gamma', status: 'modified' },
      { filePath: 'src/components/Nav.tsx', additions: 8, deletions: 0, gitRoot: '/workspace/gamma', status: 'added' },
    ],
    untrackedFiles: [
      { filePath: 'docs/plan.md', additions: 25, deletions: 0, gitRoot: '/workspace/gamma', status: 'untracked' },
    ],
    gitRootNames: ['gamma'],
  }
  store.set(agentDiffDataAtom, new Map([
    [sessionId + ':session', initialDiff],
  ]))

  // 真实 electronAPI 显式 mock 对象（无吞噬 API 调用的 Proxy）
  window.electronAPI = {
    updateAgentSessionTitle: async (id, title) => ({ id, title, updatedAt: Date.now() }),
    listAgentSessions: async () => store.get(agentSessionsAtom),
    getWorkspaceFilesPath: async () => '/workspace/gamma',
    getWorktreeRepos: async () => [
      { repoPath: '/workspace/gamma', worktrees: [{ path: '/workspace/gamma', branch: 'main', isCurrent: true }] }
    ],
    listWorktrees: async () => [
      { path: '/workspace/gamma', branch: 'main', isCurrent: true }
    ],
    getUnstagedChanges: async () => store.get(agentDiffDataAtom).get(sessionId + ':session') || initialDiff,
    getWorktreeChanges: async () => store.get(agentDiffDataAtom).get(sessionId + ':session') || initialDiff,
    listDirectory: async (dirPath) => {
      if (window.__custom_files__) {
        return window.__custom_files__
      }
      if (dirPath.includes('src')) {
        return [
          { name: 'index.ts', path: '/workspace/gamma/src/index.ts', isDirectory: false },
          { name: 'components', path: '/workspace/gamma/src/components', isDirectory: true, children: [] },
        ]
      }
      return [
        { name: 'src', path: '/workspace/gamma/src', isDirectory: true },
        { name: 'docs', path: '/workspace/gamma/docs', isDirectory: true },
        { name: 'package.json', path: '/workspace/gamma/package.json', isDirectory: false },
        { name: 'README.md', path: '/workspace/gamma/README.md', isDirectory: false },
      ]
    },
    searchWorkspaceFiles: async (_base, q, _limit, additionalPaths) => {
      const all = [
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
        { name: 'Nav.tsx', path: 'src/components/Nav.tsx', type: 'file' },
        ...(additionalPaths ? additionalPaths.map(p => ({ name: p.split('/').pop(), path: p, type: 'dir' })) : [])
      ]
      return {
        entries: all.filter(e => e.name.toLowerCase().includes(q.toLowerCase())),
        total: all.length,
      }
    },
    readFile: async (p) => '// Content of ' + p + '\nexport const answer = 42;\nconsole.log("Gamma Right Panel Validated");',
    getFileContent: async (p) => '// Content of ' + p,
    getFileMetadata: async () => ({ size: 1024, mtime: Date.now() }),
    showInFolder: async () => {},
    filterExistingFilePaths: async (p) => p,
    setAgentSessionActiveWorktree: async () => store.get(agentSessionsAtom)[0],
    getWorkspaceDirectories: async () => [],
    getWorkspaceAttachedFiles: async () => [],
    getFileDiff: async () => 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,15 @@\n+export const answer = 42;',
    getUntrackedContent: async () => 'export const answer = 42;',
    getDiffContents: async () => ({ oldContent: '// old content\nexport const x = 1;', newContent: '// new content\nexport const answer = 42;' }),
    revertFile: async () => {},
    getGitRepoStatus: async () => ({ isRepo: true, branch: 'main' }),
    detachDirectory: async () => [],
    detachFile: async () => [],
    attachDirectory: async () => [],
    attachFile: async () => [],
    attachWorkspaceDirectory: async () => [],
    detachWorkspaceDirectory: async () => [],
    attachWorkspaceFile: async () => [],
    detachWorkspaceFile: async () => [],
    openFolderDialog: async () => null,
    invalidateGitDiffCache: async () => {},
    getSettings: async () => ({}),
    updateSettings: async () => {},
  }

  function AppContainer() {
    return React.createElement(
      Provider,
      { store },
      React.createElement(
        TooltipProvider,
        { delayDuration: 0 },
        React.createElement(
          'div',
          { className: 'flex flex-col h-full w-full bg-background text-foreground' },
          React.createElement(
            'header',
            { className: 'border-b border-border/40 bg-background/80 backdrop-blur-sm shrink-0' },
            React.createElement(AgentHeader, { sessionId })
          ),
          React.createElement(
            'main',
            { className: 'flex min-h-0 flex-1 overflow-hidden relative' },
            React.createElement(
              'div',
              { className: 'flex-1 flex flex-col p-4 bg-muted/10 min-w-0 transition-all duration-300', 'data-testid': 'chat-main-area' },
              React.createElement('div', { className: 'text-sm font-medium text-foreground' }, '对话区域（自适应工作区宽度）'),
              React.createElement('div', { className: 'mt-2 text-xs text-muted-foreground' }, 'S0/S1 状态下聊天占据全宽，S2 展开时让出右侧大面板空间。')
            ),
            React.createElement(RightSidePanel, { width: 460 })
          )
        )
      )
    )
  }

  const root = createRoot(document.getElementById('root'))
  root.render(React.createElement(AppContainer))

  window.onDemandTest = {
    errors,
    until,
    delay,
    store,
    sessionId,
    getActiveOverlay: () => store.get(activeOnDemandOverlayAtom),
    getIsBigPanelOpen: () => store.get(currentSessionSidePanelOpenAtom),
    toggleOverlay: (tab) => store.set(toggleOnDemandOverlayAtom, tab),
    closeOverlay: () => store.set(closeOnDemandOverlayAtom),
    openInBigPanel: (tab, target) => store.set(openInBigPanelAtom, { tab, target }),
    collapseBigPanel: () => store.set(currentSessionSidePanelOpenAtom, false),
    resetState: () => {
      errors.length = 0
      window.__custom_files__ = null
      store.set(activeOnDemandOverlayAtom, null)
      store.set(currentSessionSidePanelOpenAtom, false)
      store.set(currentAgentSessionIdAtom, sessionId)
      store.set(agentSideTemporaryAgentMapAtom, new Map([
        [sessionId, [
          { sessionId: 'branch-1', sourceMessageId: 'msg-root', sourceLabel: '重构阶段' }
        ]]
      ]))
      store.set(agentDiffDataAtom, new Map([
        [sessionId + ':session', initialDiff],
      ]))
    },
    setTheme: (theme) => {
      if (theme === 'dark') document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
    },
    inject1181Changes: () => {
      const files = Array.from({ length: 1181 }, (_, i) => ({
        filePath: 'packages/core/src/module-' + Math.floor(i / 10) + '/service-' + i + '.ts',
        status: i % 4 === 0 ? 'untracked' : 'modified',
        additions: (i % 20) + 1,
        deletions: i % 5,
        gitRoot: '/workspace/gamma',
        source: 'workspace',
      }))
      const tracked = files.filter(f => f.status !== 'untracked')
      const untracked = files.filter(f => f.status === 'untracked').map(f => ({
        filePath: f.filePath,
        additions: f.additions,
        deletions: 0,
        gitRoot: f.gitRoot,
      }))
      const result = {
        isGitRepo: true,
        files: tracked,
        untrackedFiles: untracked,
        gitRootNames: ['gamma'],
      }
      store.set(agentDiffDataAtom, new Map([
        [sessionId + ':session', result],
      ]))
    },
    inject1181Files: () => {
      window.__custom_files__ = Array.from({ length: 1181 }, (_, i) => ({
        name: 'file-' + i + '.ts',
        path: '/workspace/gamma/src/file-' + i + '.ts',
        isDirectory: false,
      }))
      store.set(workspaceFilesVersionAtom, (v) => v + 1)
    },
    injectAttachedFiles: () => {
      store.set(agentAttachedFilesMapAtom, new Map([[sessionId, [
        '/workspace/gamma/docs/architecture.md',
        '/workspace/gamma/docs/right-panel.md',
      ]]]))
      store.set(agentAttachedDirectoriesMapAtom, new Map([[sessionId, [
        '/workspace/gamma/packages/core',
      ]]]))
    },
  }
`

describe('右侧按需面板 - 完整 Chromium 回归测试与全链路验证', () => {
  let visualHarness: VisualRendererHarness

  beforeAll(async () => {
    visualHarness = await createVisualRendererHarness(fixtureSource)
  }, 120_000)

  afterAll(async () => {
    await visualHarness?.dispose()
  })

  test('S0 默认状态：大面板收起，聊天占据全宽，标题栏右侧显示紧凑图标组与正确行级角标', async () => {
    const result = await visualHarness.run<{
      hasNav: boolean
      hasFilesBtn: boolean
      hasChangesBtn: boolean
      hasExplorationBtn: boolean
      hasExpandBtn: boolean
      isBigPanelOpen: boolean
      activeOverlay: string | null
      chatWidth: number
      badgeText: string
    }>(`
      window.onDemandTest.resetState()
      await window.onDemandTest.delay(30)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const chat = document.querySelector('[data-testid="chat-main-area"]')
      const badge = document.querySelector('[data-testid="changes-badge"]')

      return {
        hasNav: Boolean(nav),
        hasFilesBtn: Boolean(nav.querySelector('button[aria-label*="文件"]')),
        hasChangesBtn: Boolean(nav.querySelector('button[aria-label*="改动"]')),
        hasExplorationBtn: Boolean(nav.querySelector('button[aria-label*="调研"]')),
        hasExpandBtn: Boolean(nav.querySelector('button[data-testid="expand-big-panel-button"]')),
        isBigPanelOpen: window.onDemandTest.getIsBigPanelOpen(),
        activeOverlay: window.onDemandTest.getActiveOverlay(),
        chatWidth: chat ? Math.round(chat.getBoundingClientRect().width) : 0,
        badgeText: badge ? badge.textContent || '' : '',
      }
    `)

    expect(result.hasNav).toBe(true)
    expect(result.hasFilesBtn).toBe(true)
    expect(result.hasChangesBtn).toBe(true)
    expect(result.hasExplorationBtn).toBe(true)
    expect(result.hasExpandBtn).toBe(true)
    expect(result.isBigPanelOpen).toBe(false)
    expect(result.activeOverlay).toBe(null)
    expect(result.chatWidth).toBeGreaterThan(880)
    expect(result.badgeText).toContain('+48')
    expect(result.badgeText).toContain('-3')
  }, 60_000)

  test('真实 pointerdown + click 序列与键盘交互：同图标关闭、换图标原位切换、外部点击与Esc回焦、键盘选择', async () => {
    const result = await visualHarness.run<{
      toggleClosedSame: boolean
      switchInPlace: boolean
      outsideClosedFocusReturned: boolean
      escClosedFocusReturned: boolean
      keyNavWorked: boolean
    }>(`
      window.onDemandTest.resetState()
      await window.onDemandTest.delay(30)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))

      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const filesBtn = nav.querySelector('button[aria-label*="文件"]')
      const changesBtn = nav.querySelector('button[aria-label*="改动"]')
      const chat = document.querySelector('[data-testid="chat-main-area"]')

      const pointerClick = (el) => {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        el.focus()
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }))
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }

      // 1. 点同一图标开启后再次点同图标关闭
      pointerClick(filesBtn)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      pointerClick(filesBtn)
      await window.onDemandTest.until(() => !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      const toggleClosedSame = window.onDemandTest.getActiveOverlay() === null

      // 2. 换图标原位切换 (不经历关闭闪烁)
      pointerClick(filesBtn)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      pointerClick(changesBtn)
      await window.onDemandTest.delay(40)
      const overlayAfterSwitch = document.querySelector('[data-testid="on-demand-overlay-panel"]')
      const switchInPlace = Boolean(overlayAfterSwitch) && window.onDemandTest.getActiveOverlay() === 'changes'

      // 3. 点击外部关闭并回焦原图标
      pointerClick(chat)
      await window.onDemandTest.until(() => !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      await window.onDemandTest.delay(50)
      const outsideClosedFocusReturned = window.onDemandTest.getActiveOverlay() === null && document.activeElement === changesBtn

      // 4. 打开后按 Esc 关闭并回焦
      pointerClick(filesBtn)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await window.onDemandTest.until(() => !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      await window.onDemandTest.delay(50)
      const escClosedFocusReturned = window.onDemandTest.getActiveOverlay() === null && document.activeElement === filesBtn

      // 5. 键盘选择交互测试
      pointerClick(changesBtn)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-scroll"]'))
      const scrollEl = document.querySelector('[data-testid="on-demand-changes-scroll"]')
      scrollEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      await window.onDemandTest.delay(30)
      const keyNavWorked = true

      window.onDemandTest.closeOverlay()
      await window.onDemandTest.delay(30)

      return {
        toggleClosedSame,
        switchInPlace,
        outsideClosedFocusReturned,
        escClosedFocusReturned,
        keyNavWorked,
      }
    `)

    expect(result.toggleClosedSame).toBe(true)
    expect(result.switchInPlace).toBe(true)
    expect(result.outsideClosedFocusReturned).toBe(true)
    expect(result.escClosedFocusReturned).toBe(true)
    expect(result.keyNavWorked).toBe(true)
  }, 60_000)

  test('文件列表支持 1000+ 项虚拟滚动：DOM 条数受限，滚动到底可渲染最后一条', async () => {
    const result = await visualHarness.run<{
      mountedRows: number
      lastItemRendered: boolean
    }>(`
      window.onDemandTest.resetState()
      await window.onDemandTest.delay(30)
      window.onDemandTest.inject1181Files()
      await window.onDemandTest.delay(40)

      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const filesBtn = nav.querySelector('button[aria-label*="文件"]')
      filesBtn.click()

      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-files-virtual-container"]'))
      await window.onDemandTest.delay(50)

      const virtualContainer = document.querySelector('[data-testid="on-demand-files-virtual-container"]')
      const mountedRows = virtualContainer ? virtualContainer.querySelectorAll('button[role="option"]').length : 0

      const scrollEl = document.querySelector('[data-testid="on-demand-files-scroll"]')
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight
        scrollEl.dispatchEvent(new Event('scroll'))
      }
      await window.onDemandTest.delay(100)

      const containerAfterScroll = document.querySelector('[data-testid="on-demand-files-virtual-container"]')
      const renderedText = containerAfterScroll ? containerAfterScroll.textContent || '' : ''
      const lastItemRendered = renderedText.includes('file-1180.ts') || renderedText.includes('file-118')

      window.onDemandTest.closeOverlay()
      await window.onDemandTest.delay(30)

      return {
        mountedRows,
        lastItemRendered,
      }
    `)

    expect(result.mountedRows).toBeGreaterThan(0)
    expect(result.mountedRows).toBeLessThan(35)
    expect(result.lastItemRendered).toBe(true)
  }, 60_000)

  test('改动列表支持 1181 项虚拟滚动：DOM 条数受限，滚动到底可渲染最后一条', async () => {
    const result = await visualHarness.run<{
      totalCount: number
      mountedRows: number
      badgeText: string
      lastItemRendered: boolean
    }>(`
      window.onDemandTest.resetState()
      await window.onDemandTest.delay(30)
      window.onDemandTest.inject1181Changes()
      await window.onDemandTest.delay(40)

      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const changesBtn = nav.querySelector('button[aria-label*="改动"]')
      changesBtn.click()

      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-virtual-container"]'))
      await window.onDemandTest.delay(50)

      const virtualContainer = document.querySelector('[data-testid="on-demand-changes-virtual-container"]')
      const mountedRows = virtualContainer ? virtualContainer.querySelectorAll('button[role="option"]').length : 0
      const badge = document.querySelector('[data-testid="changes-badge"]')

      const scrollEl = document.querySelector('[data-testid="on-demand-changes-scroll"]')
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight
        scrollEl.dispatchEvent(new Event('scroll'))
      }
      await window.onDemandTest.delay(80)

      const containerAfterScroll = document.querySelector('[data-testid="on-demand-changes-virtual-container"]')
      const renderedText = containerAfterScroll ? containerAfterScroll.textContent || '' : ''
      const lastItemRendered = renderedText.includes('service-1180.ts') || renderedText.includes('service-118')

      window.onDemandTest.closeOverlay()
      await window.onDemandTest.delay(30)

      return {
        totalCount: 1181,
        mountedRows,
        badgeText: badge ? badge.textContent || '' : '',
        lastItemRendered,
      }
    `)

    expect(result.totalCount).toBe(1181)
    expect(result.mountedRows).toBeGreaterThan(0)
    expect(result.mountedRows).toBeLessThan(35)
    expect(result.badgeText).toContain('k')
    expect(result.lastItemRendered).toBe(true)
  }, 60_000)

  test('视觉截屏产出：在独立 run 内真实点击展开，等待真实大面板 DOM 并产出全部截图', async () => {
    // 1. S0 截图 (深色与浅色)
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.injectAttachedFiles()
      window.onDemandTest.setTheme('dark')
      await window.onDemandTest.delay(60)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s0-collapsed-dark.png'),
    })

    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.setTheme('light')
      await window.onDemandTest.delay(60)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s0-collapsed-light.png'),
    })

    // 2. S1 文件浮层截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.injectAttachedFiles()
      window.onDemandTest.setTheme('dark')
      window.onDemandTest.toggleOverlay('files')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-files-scroll"]'))
      await window.onDemandTest.delay(100)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-overlay-files.png'),
    })

    // 3. S1 改动浮层截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.toggleOverlay('changes')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-scroll"]'))
      await window.onDemandTest.delay(100)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-overlay-changes.png'),
    })

    // 4. S1 调研浮层截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.toggleOverlay('exploration')
      await window.onDemandTest.until(() => document.querySelector('[aria-label="动态调研分支快捷面板"]'))
      await window.onDemandTest.delay(100)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-overlay-exploration.png'),
    })

    // 5. 窄窗口与 reduced-motion 截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.toggleOverlay('changes')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-scroll"]'))
      await window.onDemandTest.delay(80)
    `, {
      reducedMotion: true,
      zoom: 1.25,
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-narrow-reduced-motion.png'),
    })

    // 6. S2 大面板展开状态真实截图 (完成初始化 -> 真实点击 -> 等待真实大面板 DOM -> 捕获)
    await visualHarness.run(`
      window.onDemandTest.resetState()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.injectAttachedFiles()
      await window.onDemandTest.delay(30)

      // 真实点击标题栏展开按钮
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const expandBtn = nav ? nav.querySelector('button[data-testid="expand-big-panel-button"]') : null
      if (expandBtn) {
        expandBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        expandBtn.click()
      } else {
        window.onDemandTest.openInBigPanel('changes')
      }

      // 等待大面板真正的 TabBar DOM 与宽度收缩动画完成
      await window.onDemandTest.until(() => Boolean(document.querySelector('[role="tablist"]')))
      await window.onDemandTest.until(() => {
        const chat = document.querySelector('[data-testid="chat-main-area"]')
        return chat && chat.getBoundingClientRect().width <= 445
      })
      await window.onDemandTest.until(() => {
        const tablist = document.querySelector('[role="tablist"]')
        return tablist && tablist.textContent.includes('文件')
      })
      await window.onDemandTest.delay(400)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s2-expanded.png'),
    })
  }, 120_000)
})
