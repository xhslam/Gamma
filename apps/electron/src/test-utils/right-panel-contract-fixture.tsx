import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import type { FileAccessOptions, UnstagedChangesResult } from '@gamma/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OnDemandRightPanelNav } from '@/components/agent/OnDemandRightPanelNav'
import {
  agentSessionPathMapAtom,
  agentSessionsAtom,
  agentSidePanelOpenMapAtom,
  agentWorkspacesAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  workspaceAttachedFilesMapAtom,
} from '@/atoms/agent-atoms'
import '@/styles/globals.css'

/** 独立验证生产组件；mock 的签名与返回值必须满足真实 preload 契约。 */
export async function mountRightPanelContractFixture() {
  const store = createStore()
  const sessionId = 'contract-session'
  const workspaceId = 'contract-workspace-id'
  const projectRoot = '/contract/project'
  const sessionRoot = '/contract/session-private'
  const errors: string[] = []
  const directoryCalls: Array<{ path: string; access?: FileAccessOptions }> = []
  const diffCalls: Array<Parameters<typeof window.electronAPI.getUnstagedChanges>> = []
  const diff: UnstagedChangesResult = { isGitRepo: true, files: [], untrackedFiles: [], gitRootNames: ['project'] }
  const mock: Partial<typeof window.electronAPI> = {
    getWorkspaceFilesPath: async () => projectRoot,
    getUnstagedChanges: async (...args) => { diffCalls.push(args); return diff },
    getWorktreeChanges: async () => diff,
    listWorktrees: async () => [],
    listDirectory: async (path, access) => {
      directoryCalls.push({ path, access })
      return [{ path: `${path}/root-file.ts`, name: 'root-file.ts', isDirectory: false }]
    },
    searchWorkspaceFiles: async () => ({ entries: [], total: 0, sessionEntries: [], workspaceEntries: [] }),
  }
  window.electronAPI = mock as typeof window.electronAPI
  window.addEventListener('error', (event) => errors.push(event.message))
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))

  store.set(agentSidePanelOpenMapAtom, {})
  store.set(currentAgentSessionIdAtom, sessionId)
  store.set(currentAgentWorkspaceIdAtom, workspaceId)
  store.set(agentWorkspacesAtom, [{
    id: workspaceId, slug: 'contract-workspace-slug', name: '契约工作区',
    projectRootPath: projectRoot, projectRootStatus: 'available', createdAt: 1, updatedAt: 2,
  }])
  store.set(agentSessionsAtom, [{ id: sessionId, title: '契约会话', workspaceId, createdAt: 1, updatedAt: 2 }])
  store.set(agentSessionPathMapAtom, new Map([[sessionId, sessionRoot]]))
  store.set(workspaceAttachedFilesMapAtom, new Map([[workspaceId, ['/contract/attached/pinned.md']]]))

  document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}</style>')
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('测试宿主缺少 root')
  const root = createRoot(rootElement)
  root.render(
    <Provider store={store}>
      <TooltipProvider delayDuration={0}>
        <main style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 80 }} aria-hidden="true" />
          <header data-testid="contract-header" style={{ padding: '0 12px', display: 'flex', height: 32 }}>
            <OnDemandRightPanelNav sessionId={sessionId} />
          </header>
          <button data-testid="contract-outside" type="button" style={{ alignSelf: 'flex-start', margin: 24 }}>对话区域</button>
        </main>
      </TooltipProvider>
    </Provider>,
  )

  const delay = (ms = 35) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const until = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (errors.length) throw new Error(errors.join('; '))
      if (predicate()) return
      await delay(20)
    }
    throw new Error(`契约条件未满足：${document.body.innerText.slice(0, 700)}`)
  }
  await until(() => Boolean(document.querySelector('[data-testid="on-demand-right-panel-nav"]')))
  return { store, sessionId, workspaceId, projectRoot, sessionRoot, directoryCalls, diffCalls, errors, delay, until }
}
