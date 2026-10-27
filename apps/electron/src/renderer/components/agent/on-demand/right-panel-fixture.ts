/** 真实工作区叠层、按需入口与大面板的隔离渲染夹具；不访问用户文件或IPC。 */
export const rightPanelFixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Provider, createStore, atom, useAtomValue } from 'jotai'
  import { TooltipProvider } from '@/components/ui/tooltip'
  import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
  import { AgentHeader } from '@/components/agent/AgentHeader'
  import { RightSidePanel } from '@/components/app-shell/RightSidePanel'
  import { WorkspacePanels } from '@/components/app-shell/WorkspacePanels'
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
    agentTerminalTabsAtom,
    agentAttachedFilesMapAtom,
    agentAttachedDirectoriesMapAtom,
    agentSidePanelLayoutAtomFamily,
    workspaceFilesVersionAtom,
    workspaceGitDiffRefreshVersionAtom,
  } from '@/atoms/agent-atoms'
  import {
    activeOnDemandOverlayAtom,
    openInBigPanelAtom,
    toggleOnDemandOverlayAtom,
    closeOnDemandOverlayAtom,
  } from '@/atoms/on-demand-panel-atoms'
  import { previewFileMapAtom, previewFilesMapAtom, previewPanelOpenMapAtom } from '@/atoms/preview-atoms'
  import '@/styles/globals.css'

  document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0;overflow:hidden;}</style>')
  const errors = []
  window.addEventListener('error', (event) => errors.push(event.error?.stack || event.message))
  window.addEventListener('unhandledrejection', (event) => errors.push(event.reason?.stack || String(event.reason)))
  const delay = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return
      if (errors.length) throw new Error(errors.join('; '))
      await delay(15)
    }
    throw new Error('断言超时，当前内容：' + document.body.innerText.slice(0, 600))
  }

  localStorage.clear()
  const store = createStore()
  const modalOpenAtom = atom(false)
  const sessionId = 'session-test-1'

  // 初始化真实基础状态
  store.set(currentAgentSessionIdAtom, sessionId)
  // Atom 在模块导入时可能已读取上个隔离窗口的存储值，显式重置初始状态。
  store.set(agentSidePanelOpenAtomFamily(sessionId), false)
  store.set(currentAgentWorkspaceIdAtom, 'ws-1')
  store.set(agentWorkspacesAtom, [
    { id: 'ws-1', name: 'Gamma', slug: 'gamma', projectRootPath: '/workspace/gamma', createdAt: 1, updatedAt: 1 }
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
      workspaceId: 'ws-1',
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

  // 当前已打开的调研分支（图标仅在存在活跃分支时出现）
  store.set(agentSideTemporaryAgentMapAtom, new Map([[sessionId, [{
    sessionId: 'branch-1',
    sourceMessageId: 'msg-root',
    sourceLabel: '重构阶段',
  }]]]))

  // 初始化改动数据缓存 (使用 sessionId:session 统一键)
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
    [sessionId, initialDiff],
  ]))

  const fileReads = []
  const terminalCreates = []
  let diffFetchCount = 0
  // 模拟真实完整 electronAPI；未声明的能力返回空值，避免后台effect噪声。
  const defaultElectronAPI = {
    createTerminal: async (input) => { terminalCreates.push(input.terminalId) },
    getTerminalSnapshot: async () => ({ output: 'GAMMA_TERMINAL_HISTORY', sequence: 0 }),
    updateAgentSessionTitle: async (id, title) => ({ id, title, updatedAt: Date.now() }),
    listAgentSessions: async () => store.get(agentSessionsAtom),
    getWorkspaceDirectories: async () => [],
    getWorkspaceAttachedFiles: async () => [],
    getAgentBrowserState: async () => null,
    onAttachedDirectoryChanged: () => () => {},
    onWorkspaceFilesChanged: () => () => {},
    getWorkspaceFilesPath: async () => '/workspace/gamma',
    getWorktreeRepos: async () => [
      { repoPath: '/workspace/gamma', worktrees: [{ path: '/workspace/gamma', branch: 'main', isCurrent: true }] }
    ],
    getUnstagedChanges: async () => { diffFetchCount += 1; return initialDiff },
    getWorktreeChanges: async () => initialDiff,
    getDiffContents: async () => ({ oldContent: 'export const answer = 41;', newContent: 'export const answer = 42; // GAMMA_DIFF_READY' }),
    resolveAndReadFile: async (path) => { fileReads.push(path); return { resolvedPath: path, content: 'export const answer = 42; // GAMMA_FILE_READY' } },
    listDirectory: async (dirPath) => {
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
    searchWorkspaceFiles: async (_base, q) => ({
      entries: [
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
        { name: 'Nav.tsx', path: 'src/components/Nav.tsx', type: 'file' },
      ].filter(e => e.name.toLowerCase().includes(q.toLowerCase()))
    }),
    readFile: async (p) => '// Content of ' + p + '\nexport const answer = 42;\nconsole.log("Gamma Right Panel Validated");',
    getFileContent: async (p) => '// Content of ' + p,
    getFileMetadata: async () => ({ size: 1024, mtime: Date.now() }),
    showInFolder: async () => {},
    filterExistingFilePaths: async (p) => p,
    setAgentSessionActiveWorktree: async () => store.get(agentSessionsAtom)[0],
    getFileDiff: async () => 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts',
    getUntrackedContent: async () => 'export const answer = 42;',
    revertFile: async () => {},
    getGitRepoStatus: async () => ({ isRepo: true, branch: 'main' }),
    detachDirectory: async () => [], detachFile: async () => [],
    attachDirectory: async () => [], attachFile: async () => [],
    attachWorkspaceDirectory: async () => [], detachWorkspaceDirectory: async () => [],
    attachWorkspaceFile: async () => [], detachWorkspaceFile: async () => [],
    openFolderDialog: async () => null,
    invalidateGitDiffCache: async () => {},
    getSettings: async () => ({}), updateSettings: async () => {},
  }
  window.electronAPI = new Proxy(defaultElectronAPI, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {}
      return async () => null
    },
  })

  function WorkbenchPanels() {
    const workspaceOpen = useAtomValue(currentSessionSidePanelOpenAtom)
    const modalOpen = useAtomValue(modalOpenAtom)
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(WorkspacePanels, {
        workspaceSide: 'right',
        workspaceOpen,
        workspaceWidth: 460,
        minimumWidth: 300,
        maximumWidth: 600,
        onResizeStart: () => {},
        onResizeKeyDown: () => {},
        agent: React.createElement(
          'div',
          { className: 'flex h-full min-h-0 flex-col bg-background' },
          React.createElement(AgentHeader, { sessionId }),
          React.createElement(
            'main',
            { className: 'flex-1 flex flex-col p-4 bg-background min-w-0', 'data-testid': 'chat-main-area' },
            React.createElement('div', { className: 'text-sm font-medium text-foreground' }, '对话区域（自适应工作区宽度）'),
            React.createElement('div', { className: 'mt-2 text-xs text-muted-foreground' }, 'S0/S1 状态下聊天占据全宽，S2 展开时让出右侧大面板空间。')
          )
        ),
        workspace: React.createElement(RightSidePanel, { width: 460 }),
      }),
      React.createElement(
        Dialog,
        { open: modalOpen, onOpenChange: (open) => store.set(modalOpenAtom, open) },
        React.createElement(
          DialogContent,
          {
            'data-testid': 'on-demand-layering-modal',
            'aria-describedby': undefined,
            className: 'h-[80vh] w-[90vw] max-w-none',
            hideClose: true,
            // 保留已打开浮层，单独验证两者并存时主模态的遮挡与命中优先级。
            onOpenAutoFocus: (event) => event.preventDefault(),
          },
          React.createElement(DialogTitle, null, '主模态层级回归')
        )
      )
    )
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
          React.createElement(WorkbenchPanels)
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
    sessionId, fileReads,
    clearExplorationTabs: () => store.set(agentSideTemporaryAgentMapAtom, new Map()),
    getActiveTab: () => store.get(agentDiffPanelTabAtom).get(sessionId),
    getTerminalTabs: () => store.get(agentTerminalTabsAtom).get(sessionId) ?? [],
    terminalCreates,
    setClosedActiveTab: (tab) => store.set(agentDiffPanelTabAtom, new Map([[sessionId, tab]])),
    getPreviewFiles: () => store.get(previewFilesMapAtom).get(sessionId) ?? [],
    setLegacyActiveTab: (tab) => { store.set(agentDiffPanelTabAtom, new Map([[sessionId, tab]])); store.set(currentSessionSidePanelOpenAtom, true) },
    diffFetchCount: () => diffFetchCount,
    getPreviewFile: () => store.get(previewFileMapAtom).get(sessionId),
    getActiveOverlay: () => store.get(activeOnDemandOverlayAtom),
    getIsBigPanelOpen: () => store.get(currentSessionSidePanelOpenAtom),
    setModalOpen: (open) => store.set(modalOpenAtom, open),
    toggleOverlay: (tab) => store.set(toggleOnDemandOverlayAtom, tab),
    closeOverlay: () => store.set(closeOnDemandOverlayAtom),
    openInBigPanel: (tab, target) => store.set(openInBigPanelAtom, { tab, target }),
    collapseBigPanel: () => store.set(currentSessionSidePanelOpenAtom, false),
    resetState: () => {
      errors.length = 0
      store.set(modalOpenAtom, false)
      store.set(activeOnDemandOverlayAtom, null)
      store.set(currentSessionSidePanelOpenAtom, false)
      store.set(currentAgentSessionIdAtom, sessionId)
      store.set(agentDiffDataAtom, new Map([[sessionId + ':session', initialDiff], [sessionId, initialDiff]]))
    },
    setTheme: (theme) => {
      if (theme === 'dark') document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
    },
    // 注入 1181 个真实变更文件
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
        [sessionId, result],
      ]))
    },
    inject1181Files: () => {
      const original = window.electronAPI.listDirectory
      window.electronAPI.listDirectory = async path => path === '/workspace/gamma'
        ? Array.from({length: 1181}, (_, i) => ({
            name: i === 1 ? 'very-long-file-title-'.repeat(16) + '.ts' : i < 3 ? 'folder-' + i : 'source-' + i + '.ts',
            path: '/workspace/gamma/' + (i === 1 ? 'very-long-file-title-'.repeat(16) + '.ts' : i < 3 ? 'folder-' + i : 'source-' + i + '.ts'),
            isDirectory: i === 0 || i === 2,
          }))
        : original(path)
    },
    // 注入附加文件
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
