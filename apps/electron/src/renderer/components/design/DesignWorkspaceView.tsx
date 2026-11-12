import * as React from 'react'
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { atomFamily } from 'jotai-family'
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, Download, Film, FolderOpen, Grid2X2, Layers, List, Loader2, Palette, Paperclip, Presentation, RefreshCw, Search, SquarePen } from 'lucide-react'
import type { DesignArtifact, DesignArtifactKind, DesignBundleStatus, DesignWorkbenchOpenResult } from '@gamma/shared'
import { DESIGN_SOURCE_URL } from '@gamma/shared'
import {
  agentSessionsAtom, agentWorkspacesAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom,
  agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily, getBrowserSidePanelTab,
} from '@/atoms/agent-atoms'
import { addDesignHandoffToConversationAtom } from '@/atoms/design-handoff'
import { activeViewAtom } from '@/atoms/active-view'
import { browserFocusRequestMapAtom, browserPanelMinimizedMapAtom, browserPanelOpenMapAtom, browserPendingNavigationMapAtom, browserStateMapAtom } from '@/atoms/browser-atoms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCreateSession } from '@/hooks/useCreateSession'
import { cn } from '@/lib/utils'
import { DESIGN_ARTIFACT_TYPES, filterDesignArtifacts } from './design-workbench-model'
import type { DesignSort } from './design-workbench-model'
import { readGammaDesignTheme, useDesignEditorTheme } from './design-theme'

const AgentView = React.lazy(() => import('@/components/agent/AgentView').then((module) => ({ default: module.AgentView })))
const activeDesignAtomFamily = atomFamily((_workspaceId: string) => atom<DesignWorkbenchOpenResult | null>(null))
const TYPE_ICONS = { canvas: Palette, slides: Presentation, system: Layers, dashboard: ChartNoAxesCombined, motion: Film, whiteboard: SquarePen }

export interface DesignWorkspaceViewProps { embedded?: boolean; workspaceId?: string; sessionId?: string }

/** 独立工作台避免与主会话同时挂载同一个 AgentView；模型与认证仍复用同一会话。 */
export function DesignWorkspaceView({ embedded = false, workspaceId: requestedId, sessionId }: DesignWorkspaceViewProps): React.ReactElement {
  const selectedId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspace = workspaces.find((item) => item.id === (requestedId ?? selectedId))
  if (!workspace) return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">请先选择项目，再打开 design。</div>
  return <DesignProject key={workspace.id} workspaceId={workspace.id} workspaceName={workspace.name} sourceSessionId={sessionId} embedded={embedded} />
}

function DesignProject({ workspaceId, workspaceName, sourceSessionId, embedded }: {
  workspaceId: string; workspaceName: string; sourceSessionId?: string; embedded: boolean
}): React.ReactElement {
  const store = useStore()
  const [active, setActive] = useAtom(activeDesignAtomFamily(workspaceId))
  const initialArtifact = React.useRef(active?.artifact)
  const [resuming, setResuming] = React.useState(Boolean(active && !embedded))
  const [status, setStatus] = React.useState<DesignBundleStatus | null>(null)
  const [artifacts, setArtifacts] = React.useState<DesignArtifact[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [creatingKind, setCreatingKind] = React.useState<DesignArtifactKind | null>(null)
  const [title, setTitle] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [kind, setKind] = React.useState<DesignArtifactKind | 'all'>('all')
  const [sort, setSort] = React.useState<DesignSort>('recent')
  const [listMode, setListMode] = React.useState(false)
  const mounted = React.useRef(true)
  const operation = React.useRef(false)
  const setActiveView = useSetAtom(activeViewAtom)
  const { createAgent } = useCreateSession()

  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [bundle, entries] = await Promise.allSettled([window.electronAPI.getDesignBundleStatus(), window.electronAPI.listDesignArtifacts(workspaceId)])
      if (!mounted.current) return
      if (bundle.status === 'fulfilled') setStatus(bundle.value)
      else setStatus(null)
      if (entries.status === 'fulfilled') setArtifacts(entries.value)
      const failed = [bundle, entries].find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '无法读取设计作品') }
    finally { if (mounted.current) setLoading(false) }
  }, [workspaceId])
  React.useEffect(() => { void refresh() }, [refresh])

  const open = async (artifact: DesignArtifact): Promise<void> => {
    const result = await window.electronAPI.openDesignArtifact(workspaceId, artifact.id, readGammaDesignTheme())
    if (!mounted.current) return
    store.set(agentSessionsAtom, (sessions) => sessions.some((item) => item.id === result.session.id)
      ? sessions.map((item) => item.id === result.session.id ? result.session : item) : [result.session, ...sessions])
    store.set(browserStateMapAtom, (previous) => new Map(previous).set(result.session.id, result.browser))
    const selected = result.browser.tabs.find((tab) => tab.tabId === result.browser.activeTabId)
    store.set(browserPendingNavigationMapAtom, (previous) => {
      const next = new Map(previous)
      if (selected?.url !== result.url) next.set(result.session.id, result.url)
      else next.delete(result.session.id)
      return next
    })
    // 浏览器只由全局侧栏挂载；会话、展开状态和画板标签必须一起切换。
    store.set(currentAgentWorkspaceIdAtom, workspaceId)
    store.set(currentAgentSessionIdAtom, result.session.id)
    store.set(browserPanelOpenMapAtom, (previous) => new Map(previous).set(result.session.id, true))
    store.set(browserPanelMinimizedMapAtom, (previous) => {
      const next = new Map(previous)
      next.delete(result.session.id)
      return next
    })
    store.set(agentSidePanelOpenAtomFamily(result.session.id), true)
    store.set(agentDiffPanelTabAtom, (previous) => new Map(previous).set(result.session.id, getBrowserSidePanelTab(result.browser.activeTabId)))
    store.set(browserFocusRequestMapAtom, (previous) => new Map(previous).set(result.session.id, result.browser.activeTabId))
    setActive(result)
    // 右侧添加入口与左侧 design 统一进入主工作台，不同时重复渲染同一聊天。
    if (embedded) {
      setActiveView('design')
    }
  }
  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError('')
    try { await action() } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'design 操作失败') }
    finally { operation.current = false; if (mounted.current) setBusy(false) }
  }
  const create = (): void => { void perform(async () => {
    if (!creatingKind || !title.trim()) return
    const candidateId = sourceSessionId ?? store.get(currentAgentSessionIdAtom)
    const source = store.get(agentSessionsAtom).find((item) => item.id === candidateId && item.workspaceId === workspaceId)
    // 有来源会话则直接绑定：设计聊天和普通聊天天然使用同一个模型配置。
    const sessionId = source?.id ?? await createAgent({ draft: true, open: false, workspaceId })
    if (!sessionId || !mounted.current) throw new Error('无法创建设计会话')
    const artifact = await window.electronAPI.createDesignArtifact({ workspaceId, sessionId, title: title.trim(), kind: creatingKind })
    if (!mounted.current) return
    setArtifacts((items) => [artifact, ...items]); setCreatingKind(null); setTitle('')
    await open(artifact)
  }) }
  const back = (): void => { void perform(async () => {
    if (active) await window.electronAPI.closeDesignArtifact(active.artifact.id)
    if (mounted.current) { setActive(null); await refresh() }
  }) }

  React.useEffect(() => {
    const artifact = initialArtifact.current
    if (!artifact || embedded) return
    // 重新进入时必须由主进程重新核验、绑定上下文并恢复评论，不沿用旧浏览器快照。
    void perform(async () => {
      try { await open(artifact) } catch (cause) { if (mounted.current) setActive(null); throw cause }
    }).finally(() => { if (mounted.current) setResuming(false) })
    // 初始 artifact 固定在组件创建时，切换作品由显式 open 处理。
  }, [workspaceId, embedded])

  // 切离工作台立即停评论，避免已关闭的页面在后台继续唤醒 Agent。
  React.useEffect(() => {
    if (!active || embedded) return
    return () => { void window.electronAPI.closeDesignArtifact(active.artifact.id).catch(() => undefined) }
  }, [active?.artifact.id, embedded])

  if (resuming && !embedded) return <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />正在恢复设计工作台…</div>
  if (active && !embedded) return <DesignEditorWorkbench entry={active} busy={busy} error={error} onBack={back} />
  const visible = filterDesignArtifacts(artifacts, query, kind, sort)
  return (
    <section aria-label="design 作品库" className="@container flex h-full min-h-0 flex-col overflow-y-auto bg-content-area titlebar-no-drag">
      <div className={cn('mx-auto w-full max-w-6xl px-5 py-6', !embedded && 'px-8 py-9')}>
        <header className="mb-7 flex items-center gap-3">
          <Palette size={23} strokeWidth={1.5} /><div className="min-w-0 flex-1"><h1 className="text-lg font-medium">design</h1><p className="truncate text-xs text-muted-foreground">{workspaceName}</p></div>
          <a href={DESIGN_SOURCE_URL} target="_blank" rel="noreferrer" aria-label="baoyu-design 源码" className="rounded p-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ArrowUpRight size={15} /></a>
          <Button variant="ghost" size="icon" aria-label="刷新作品库" disabled={loading || busy} onClick={() => { void refresh() }}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></Button>
        </header>
        {!loading && status && !status.installed && <p role="status" className="mb-4 text-xs text-destructive">内置设计编辑器资源不完整，请检查 Gamma 构建产物。</p>}
        {status?.installed && !status.supportsSqlite && <p role="status" className="mb-4 text-xs text-warning">当前 Node 环境不支持 SQLite，看板和动画编辑器暂不可用。</p>}
        {error && <p role="alert" className="mb-4 break-words text-xs leading-relaxed text-destructive">{error}</p>}
        <div className="mb-8 grid grid-cols-2 gap-2">{DESIGN_ARTIFACT_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type.kind]
          const unsupported = (type.kind === 'dashboard' || type.kind === 'motion') && !status?.supportsSqlite
          return <button key={type.kind} type="button" disabled={!status?.installed || busy || unsupported} onClick={() => { setCreatingKind(type.kind); setTitle('') }} className="group min-w-0 break-words rounded-xl border border-border bg-background/40 px-4 py-4 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"><Icon size={19} strokeWidth={1.5} className="mb-4 text-foreground/65" /><span className="block text-sm font-medium">{type.label}</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{type.hint}</span></button>
        })}</div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-36 flex-1"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索设计作品" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品" className="h-8 pl-8 text-xs" /></div>
          <select aria-label="筛选作品类型" value={kind} onChange={(event) => setKind(event.target.value as DesignArtifactKind | 'all')} className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs"><option value="all">全部类型</option>{DESIGN_ARTIFACT_TYPES.map((type) => <option key={type.kind} value={type.kind}>{type.label}</option>)}</select>
          <select aria-label="作品排序" value={sort} onChange={(event) => setSort(event.target.value as DesignSort)} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="recent">最近打开</option><option value="created">创建时间</option><option value="name">名称</option></select>
          <Button variant="ghost" size="icon" aria-label={listMode ? '切换网格视图' : '切换列表视图'} className="size-8" onClick={() => setListMode((value) => !value)}>{listMode ? <Grid2X2 size={15} /> : <List size={15} />}</Button>
        </div>
        {loading ? <div role="status" className="flex justify-center gap-2 py-16 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />正在加载作品</div> : !visible.length ? <div className="rounded-xl border border-dashed border-border px-5 py-16 text-center"><FolderOpen size={25} strokeWidth={1.3} className="mx-auto mb-3 text-muted-foreground/60" /><p className="text-sm text-muted-foreground">{artifacts.length ? '没有匹配的作品' : '从上方选择一种作品开始创作'}</p></div> : <div className={cn(listMode ? 'flex flex-col gap-2' : 'grid grid-cols-1 gap-4 @[500px]:grid-cols-2 @[900px]:grid-cols-3')}>
          {visible.map((artifact) => { const Icon = TYPE_ICONS[artifact.kind]; const type = DESIGN_ARTIFACT_TYPES.find((item) => item.kind === artifact.kind)
            return <button key={artifact.id} type="button" disabled={busy} onClick={() => { void perform(() => open(artifact)) }} className={cn('min-w-0 overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', listMode && 'flex items-center gap-3 px-4 py-3')}>
              <div className={cn('flex items-center justify-center overflow-hidden bg-muted/35 text-foreground/35', listMode ? 'size-9 shrink-0 rounded-md' : 'h-36 border-b border-border/60')}>{'thumbnailDataUrl' in artifact && typeof artifact.thumbnailDataUrl === 'string' ? <img src={artifact.thumbnailDataUrl} alt="" className="h-full w-full object-cover object-top" /> : <Icon size={listMode ? 19 : 38} strokeWidth={1.2} />}</div>
              <div className={cn('min-w-0', !listMode && 'px-4 py-3')}><p className="truncate text-sm font-medium">{artifact.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{artifact.unavailableReason ?? `${type?.label} · ${new Date(artifact.updatedAt).toLocaleDateString()}`}</p></div>
            </button>
          })}
        </div>}
      </div>
      <Dialog open={creatingKind !== null} onOpenChange={(value) => { if (!busy && !value) setCreatingKind(null) }}><DialogContent><DialogHeader><DialogTitle>新建{DESIGN_ARTIFACT_TYPES.find((item) => item.kind === creatingKind)?.label}</DialogTitle></DialogHeader><form onSubmit={(event) => { event.preventDefault(); create() }}><label htmlFor={`design-name-${workspaceId}`} className="mb-2 block text-xs font-medium">作品名称</label><Input id={`design-name-${workspaceId}`} autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给作品起个名字" /><DialogFooter className="mt-5"><Button type="submit" disabled={busy || !title.trim()}>{busy && <Loader2 size={14} className="mr-2 animate-spin" />}创建并打开</Button></DialogFooter></form></DialogContent></Dialog>
    </section>
  )
}

function DesignEditorWorkbench({ entry, onBack, busy, error }: { entry: DesignWorkbenchOpenResult; onBack: () => void; busy: boolean; error: string }): React.ReactElement {
  const store = useStore()
  const [deliveryBusy, setDeliveryBusy] = React.useState(false)
  const deliveryOperation = React.useRef(false)
  const [deliveryError, setDeliveryError] = React.useState('')
  const [deliveryNotice, setDeliveryNotice] = React.useState('')
  const mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const deliver = async (mode: 'download' | 'handoff'): Promise<void> => {
    if (deliveryOperation.current || busy) return
    deliveryOperation.current = true
    setDeliveryBusy(true); setDeliveryError(''); setDeliveryNotice('')
    try {
      if (mode === 'download') {
        const result = await window.electronAPI.exportDesignArtifact(entry.artifact.workspaceId, entry.artifact.id)
        if (mounted.current && !result.canceled) setDeliveryNotice(`已保存完整设计稿：${result.filePath}`)
      } else {
        const result = await window.electronAPI.prepareDesignHandoff(entry.artifact.workspaceId, entry.artifact.id)
        if (!mounted.current) return
        if (result.sessionId !== entry.session.id || result.artifactId !== entry.artifact.id) throw new Error('设计稿与当前会话不一致')
        store.set(addDesignHandoffToConversationAtom, result)
        setDeliveryNotice('完整设计稿和实施要求已添加到对话，确认后发送即可。')
      }
    } catch (cause) { if (mounted.current) setDeliveryError(cause instanceof Error ? cause.message : '设计稿操作失败') }
    finally { deliveryOperation.current = false; if (mounted.current) setDeliveryBusy(false) }
  }
  const browserStates = useAtomValue(browserStateMapAtom)
  const browser = browserStates.get(entry.session.id) ?? entry.browser
  // 显示的是本作品绑定的标签，不跟随 Agent 浏览器工作标签或用户其他标签跳动。
  const initialTabId = entry.browser.activeTabId
  const tabId = browser.tabs.some((tab) => tab.tabId === initialTabId) ? initialTabId : browser.activeTabId
  useDesignEditorTheme(entry.artifact.id, browser.tabs.find((tab) => tab.tabId === tabId)?.url)
  return <section aria-label="design 创作工作台" className="flex h-full min-h-0 min-w-0 flex-col bg-content-area titlebar-no-drag">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3"><Button variant="ghost" size="icon" className="size-7" aria-label="返回设计作品库" disabled={busy || deliveryBusy} onClick={onBack}><ArrowLeft size={15} /></Button><h1 className="min-w-0 flex-1 truncate text-sm font-medium">{entry.artifact.title}</h1><span className="hidden shrink-0 text-[11px] text-muted-foreground @[420px]:inline">{DESIGN_ARTIFACT_TYPES.find((item) => item.kind === entry.artifact.kind)?.label}</span><Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="下载完整设计稿" title="下载完整设计稿" disabled={busy || deliveryBusy} onClick={() => { void deliver('download') }}><Download size={15} /></Button><Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="添加完整设计稿到对话" title="添加到对话并准备实施" disabled={busy || deliveryBusy} onClick={() => { void deliver('handoff') }}>{deliveryBusy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}</Button></header>
    {deliveryError && <p role="alert" className="shrink-0 break-words px-4 py-2 text-xs text-destructive">{deliveryError}</p>}
    {deliveryNotice && <p role="status" className="shrink-0 break-words px-4 py-2 text-xs text-muted-foreground">{deliveryNotice}</p>}
    {error && <p role="alert" className="shrink-0 break-words px-4 py-2 text-xs text-destructive">{error}</p>}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense fallback={<div role="status" className="p-4 text-xs text-muted-foreground">正在加载设计对话…</div>}><AgentView sessionId={entry.session.id} embedded /></React.Suspense>
    </div>
  </section>
}
