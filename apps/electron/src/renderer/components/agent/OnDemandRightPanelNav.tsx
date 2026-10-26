/**
 * OnDemandRightPanelNav — 标题栏右侧按需入口与工作区顶栏统一组件
 *
 * 承担两种呈现（单一入口组件，S0/S1 与 S2 不同时出现两套）：
 * - S0/S1 (presentation="icons" 或默认)：标题栏右侧紧凑图标组（文件/改动(+角标)/动态调研/展开）
 * - S2 (presentation="tabs")：右侧大面板顶栏，承载 DiffPanelTabBar 的全部功能（标签切换/拖拽/关闭/并排/收起）
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { FileDiff, FolderOpen, PanelLeft, PanelRight, Split } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverAnchor } from '@/components/ui/popover'
import {
  agentDiffDataAtom,
  agentDiffRefreshVersionAtom,
  agentNonGitFileChangesAtom,
  agentSelectedWorktreeAtom,
  agentSessionPathMapAtom,
  agentSessionsAtom,
  agentSidePanelLayoutAtomFamily,
  agentSideTemporaryAgentMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  currentSessionSidePanelOpenAtom,
  workspaceGitDiffRefreshVersionAtom,
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
} from '@/atoms/agent-atoms'
import {
  activeOnDemandOverlayAtom,
  agentDiffStatusAtom,
  toggleOnDemandOverlayAtom,
  closeOnDemandOverlayAtom,
  openInBigPanelAtom,
} from '@/atoms/on-demand-panel-atoms'
import { formatBadgeNumber, calculateDiffBadgeStats } from '@/lib/right-panel-badge'
import { diffBadgeClasses } from '@/lib/right-panel-theme'
import { useShortcutDisplay } from '@/hooks/useShortcutDisplay'
import {
  deriveActiveExplorationBranches,
  getExplorationTooltip,
} from '@/lib/right-panel-exploration'
import { DiffPanelTabBar } from '@/components/diff/DiffPanelTabBar'
import type { DiffPanelTabBarProps } from '@/components/diff/DiffPanelTabBar'
import { OnDemandOverlayPanel } from './on-demand/OnDemandOverlayPanel'

// 缺失的附加路径复用同一空数组，保持渲染间引用稳定。
const EMPTY_PATHS: string[] = []

export type OnDemandRightPanelNavProps =
  | {
      presentation?: 'icons'
      sessionId: string
    }
  | ({
      presentation: 'tabs'
      sessionId?: string
    } & DiffPanelTabBarProps)

export function OnDemandRightPanelNav(props: OnDemandRightPanelNavProps): React.ReactElement | null {
  if (props.presentation === 'tabs') {
    const { presentation: _p, sessionId: _s, ...tabBarProps } = props
    return <DiffPanelTabBar {...tabBarProps} />
  }

  return <OnDemandIconNav sessionId={props.sessionId} />
}

function OnDemandIconNav({ sessionId }: { sessionId: string }): React.ReactElement | null {
  const isRightPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const activeOverlay = useAtomValue(activeOnDemandOverlayAtom)
  const toggleOverlay = useSetAtom(toggleOnDemandOverlayAtom)
  const closeOverlay = useSetAtom(closeOnDemandOverlayAtom)
  const openInBigPanel = useSetAtom(openInBigPanelAtom)

  const navRef = React.useRef<HTMLDivElement>(null)
  const filesBtnRef = React.useRef<HTMLButtonElement>(null)
  const changesBtnRef = React.useRef<HTMLButtonElement>(null)
  const explorationBtnRef = React.useRef<HTMLButtonElement>(null)

  const activeBtnRef = React.useMemo(() => {
    if (activeOverlay === 'files') return filesBtnRef
    if (activeOverlay === 'changes') return changesBtnRef
    if (activeOverlay === 'exploration') return explorationBtnRef
    return undefined
  }, [activeOverlay])

  const lastActiveButtonRef = React.useRef<HTMLButtonElement | null>(null)
  React.useLayoutEffect(() => {
    if (activeBtnRef?.current) lastActiveButtonRef.current = activeBtnRef.current
  }, [activeBtnRef])

  const sessions = useAtomValue(agentSessionsAtom)
  const layout = useAtomValue(agentSidePanelLayoutAtomFamily(sessionId))
  const workspaceSide = layout.workspaceSide === 'left' ? 'left' : 'right'

  // 快捷键动态读取（跟随用户配置）
  const filesShortcut = useShortcutDisplay('toggle-right-panel-files')
  const changesShortcut = useShortcutDisplay('toggle-right-panel-changes')
  const explorationShortcut = useShortcutDisplay('toggle-right-panel-exploration')
  const bigPanelShortcut = useShortcutDisplay('toggle-right-panel')

  // 动态调研：仅读真实活跃调研分支（对齐 SidePanel 的 sideTemporaryAgentMap 规则）
  const sideTemporaryAgentMap = useAtomValue(agentSideTemporaryAgentMapAtom)
  const activeExplorationBranches = React.useMemo(
    () => deriveActiveExplorationBranches(sessionId, sideTemporaryAgentMap, sessions),
    [sessionId, sideTemporaryAgentMap, sessions],
  )
  const explorationTooltip = getExplorationTooltip(activeExplorationBranches, explorationShortcut)

  // 改动缓存 Key 与 Worktree 选择状态（尊重用户显式选择 null 回到默认 cwd）
  const selectedWorktreeMap = useAtomValue(agentSelectedWorktreeAtom)
  const currentSession = sessions.find((s) => s.id === sessionId)
  const persistedWorktreePath = currentSession?.activeWorktree?.path ?? null
  const selectedWorktreePath = selectedWorktreeMap.has(sessionId)
    ? selectedWorktreeMap.get(sessionId) ?? null
    : persistedWorktreePath
  const diffCacheKey = selectedWorktreePath
    ? `${sessionId}:worktree:${selectedWorktreePath}`
    : `${sessionId}:session`

  const diffDataMap = useAtomValue(agentDiffDataAtom)
  const setDiffDataMap = useSetAtom(agentDiffDataAtom)
  const setDiffStatusMap = useSetAtom(agentDiffStatusAtom)

  const workspaceGitDiffRefreshVersion = useAtomValue(workspaceGitDiffRefreshVersionAtom)
  const sessionDiffRefreshVersionMap = useAtomValue(agentDiffRefreshVersionAtom)
  const sessionDiffRefreshVersion = sessionDiffRefreshVersionMap.get(sessionId) ?? 0

  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId)
  const workspaceSlug = currentWorkspace?.slug
  const projectRootPath = currentWorkspace?.projectRootPath

  // 附加路径列表 (对齐 SidePanel 的 extraPaths)
  // 缺失项复用同一空数组，避免每次渲染生成新引用而反复触发取数。
  const attachedDirs = useAtomValue(agentAttachedDirectoriesMapAtom).get(sessionId) ?? EMPTY_PATHS
  const attachedFiles = useAtomValue(agentAttachedFilesMapAtom).get(sessionId) ?? EMPTY_PATHS
  const wsAttachedDirs = useAtomValue(workspaceAttachedDirectoriesMapAtom).get(workspaceId ?? '') ?? EMPTY_PATHS
  const wsAttachedFiles = useAtomValue(workspaceAttachedFilesMapAtom).get(workspaceId ?? '') ?? EMPTY_PATHS
  const extraPaths = React.useMemo(
    () => [...attachedDirs, ...wsAttachedDirs, ...attachedFiles, ...wsAttachedFiles],
    [attachedDirs, wsAttachedDirs, attachedFiles, wsAttachedFiles],
  )

  const nonGitChanges = useAtomValue(agentNonGitFileChangesAtom).get(sessionId) ?? null
  // 严格使用真实 cacheKey，不使用 sessionId 猜测回退
  const diffResult = diffDataMap.get(diffCacheKey)
  const stats = React.useMemo(() => calculateDiffBadgeStats(diffResult, nonGitChanges), [diffResult, nonGitChanges])

  // 取数仅在 S0/S1 执行；S2 展开后交给既有面板 DiffChangesList 负责
  React.useEffect(() => {
    if (!sessionId || isRightPanelOpen) return
    let disposed = false

    const fetchDiff = async () => {
      // 若当前没有缓存，先置为 loading
      setDiffStatusMap((prev) => {
        if (diffDataMap.has(diffCacheKey)) return prev
        const next = new Map(prev)
        next.set(diffCacheKey, { loading: true, error: null })
        return next
      })

      try {
        let workspaceFilesPath: string | null = null
        if (workspaceSlug && window.electronAPI?.getWorkspaceFilesPath) {
          workspaceFilesPath = await window.electronAPI.getWorkspaceFilesPath(workspaceSlug)
        }
        if (disposed) return

        const worktreeMode = selectedWorktreePath ? { path: selectedWorktreePath, baseBranch: 'origin/main' } : undefined
        const result = worktreeMode
          ? await window.electronAPI.getWorktreeChanges(worktreeMode.path, worktreeMode.baseBranch, sessionId)
          : await window.electronAPI.getUnstagedChanges(
              projectRootPath ?? sessionPath ?? '',
              sessionPath ?? undefined,
              workspaceFilesPath ?? undefined,
              extraPaths.length > 0 ? extraPaths : undefined,
              sessionId,
            )

        if (!disposed && result) {
          setDiffDataMap((prev) => {
            const next = new Map(prev)
            next.set(diffCacheKey, result)
            return next
          })
          setDiffStatusMap((prev) => {
            const next = new Map(prev)
            next.set(diffCacheKey, { loading: false, error: null })
            return next
          })
        }
      } catch (err: unknown) {
        if (!disposed) {
          const message = err instanceof Error ? err.message : String(err)
          setDiffStatusMap((prev) => {
            const next = new Map(prev)
            next.set(diffCacheKey, { loading: false, error: message || '获取代码改动失败' })
            return next
          })
        }
      }
    }

    fetchDiff()

    return () => {
      disposed = true
    }
  }, [
    sessionId,
    isRightPanelOpen,
    diffCacheKey,
    selectedWorktreePath,
    sessionPath,
    projectRootPath,
    workspaceSlug,
    extraPaths,
    workspaceGitDiffRefreshVersion,
    sessionDiffRefreshVersion,
    setDiffDataMap,
    setDiffStatusMap,
  ])

  // S2 大面板展开时由 DiffPanelTabBar 呈现，标题栏图标组隐藏
  if (isRightPanelOpen) {
    return null
  }

  const isPopoverOpen = Boolean(activeOverlay) && !isRightPanelOpen

  return (
    <Popover open={isPopoverOpen} onOpenChange={(open) => { if (!open) closeOverlay() }}>
      <PopoverAnchor asChild>
        <div
          ref={navRef}
          className="titlebar-no-drag ml-auto flex items-center gap-1 relative z-40"
          data-testid="on-demand-right-panel-nav"
        >
          {/* 1. 文件图标按钮 (热区 28px, 本体 16px) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={filesBtnRef}
                data-icon-button="true"
                type="button"
                onClick={() => toggleOverlay('files')}
                className={cn(
                  'inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                  activeOverlay === 'files'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-label={`文件 (${filesShortcut})`}
                aria-expanded={activeOverlay === 'files'}
                data-active={activeOverlay === 'files'}
              >
                <FolderOpen className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">文件 ({filesShortcut})</TooltipContent>
          </Tooltip>

          {/* 2. 改动图标按钮 (附带行级角标或文件数角标) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={changesBtnRef}
                data-icon-button="true"
                type="button"
                onClick={() => toggleOverlay('changes')}
                className={cn(
                  'inline-flex h-7 min-w-7 shrink-0 items-center gap-1 rounded-lg px-1.5 transition-colors',
                  activeOverlay === 'changes'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-label={`改动 (${changesShortcut})`}
                aria-expanded={activeOverlay === 'changes'}
                data-active={activeOverlay === 'changes'}
              >
                <FileDiff className="size-4" />
                {stats.hasChanges && (
                  <span className="flex items-center gap-0.5 font-mono text-[10px] leading-none" data-testid="changes-badge">
                    {stats.additions > 0 && (
                      <span className={diffBadgeClasses.addition}>
                        +{formatBadgeNumber(stats.additions)}
                      </span>
                    )}
                    {stats.deletions > 0 && (
                      <span className={diffBadgeClasses.deletion}>
                        -{formatBadgeNumber(stats.deletions)}
                      </span>
                    )}
                    {stats.additions === 0 && stats.deletions === 0 && (
                      <span className={diffBadgeClasses.neutral}>
                        {stats.totalFiles}
                      </span>
                    )}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {stats.hasChanges
                ? `改动：${stats.totalFiles} 个文件 (+${stats.additions} -${stats.deletions}) (${changesShortcut})`
                : `改动 (${changesShortcut})`}
            </TooltipContent>
          </Tooltip>

          {/* 3. 动态调研图标按钮 (仅存在当前有效分支时显示，Tooltip 展示真实条目标题) */}
          {activeExplorationBranches.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={explorationBtnRef}
                  data-icon-button="true"
                type="button"
                  onClick={() => toggleOverlay('exploration')}
                  className={cn(
                    'inline-flex h-7 min-w-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs transition-colors',
                    activeOverlay === 'exploration'
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-label={explorationTooltip}
                  aria-expanded={activeOverlay === 'exploration'}
                  data-active={activeOverlay === 'exploration'}
                >
                  <Split className="size-4" />
                  <span className="font-mono text-[11px] leading-none">{activeExplorationBranches.length}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {explorationTooltip}
              </TooltipContent>
            </Tooltip>
          )}

          {/* 4. 展开大面板按钮 (S2) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-icon-button="true"
                type="button"
                onClick={() => openInBigPanel({})}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`展开${workspaceSide === 'left' ? '左侧' : '右侧'}工作区`}
                title={`展开${workspaceSide === 'left' ? '左侧' : '右侧'}工作区 (${bigPanelShortcut})`}
                data-testid="expand-big-panel-button"
              >
                {workspaceSide === 'left' ? <PanelLeft className="size-4" /> : <PanelRight className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              展开{workspaceSide === 'left' ? '左侧' : '右侧'}工作区 ({bigPanelShortcut})
            </TooltipContent>
          </Tooltip>
        </div>
      </PopoverAnchor>

      {/* S1 浮层容器 */}
      <OnDemandOverlayPanel sessionId={sessionId} activeButtonRef={lastActiveButtonRef} />
    </Popover>
  )
}
