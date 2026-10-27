/**
 * OnDemandChangesContent — S1 改动按需浮层内容
 *
 * 紧凑 worktree 选择 + "本会话 N 个文件 +x −y" 汇总 +
 * 文件名/短路径/逐文件增删统计列表、untracked 保留 U、空态"暂无改动"、非 Git 降级。
 * 真正支持 1181+ 条虚拟滚动，键盘 ↑↓ 导航与 Enter 打开直达 S2（带完整 gitRoot/baseRef/sessionPath）。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import {
  agentDiffDataAtom,
  agentDiffRefreshVersionAtom,
  agentNonGitFileChangesAtom,
  agentSelectedWorktreeAtom,
  agentSessionPathMapAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import type { PreviewFile } from '@/atoms/preview-atoms'
import { openInBigPanelAtom, agentDiffStatusAtom } from '@/atoms/on-demand-panel-atoms'
import { WorktreeSelector } from '@/components/diff/WorktreeSelector'
import { formatBadgeNumber, calculateDiffBadgeStats } from '@/lib/right-panel-badge'
import { diffBadgeClasses } from '@/lib/right-panel-theme'
import type { WorktreeInfo } from '@gamma/shared'

interface FlattenedChangeFile {
  filePath: string
  status: 'untracked' | 'modified' | 'added' | 'deleted' | string
  additions: number
  deletions: number
  gitRoot?: string
}

interface OnDemandChangesContentProps {
  sessionId?: string
  onItemSelect?: () => void
}

const ROW_HEIGHT = 30

export function OnDemandChangesContent({
  sessionId: propSessionId,
  onItemSelect,
}: OnDemandChangesContentProps): React.ReactElement {
  const currentId = useAtomValue(currentAgentSessionIdAtom) ?? ''
  const sessionId = propSessionId || currentId
  const sessions = useAtomValue(agentSessionsAtom)
  const setSessions = useSetAtom(agentSessionsAtom)
  const openInBigPanel = useSetAtom(openInBigPanelAtom)

  // Worktree 状态与缓存 Key（严格使用 has 判断，尊重用户显式切回默认 cwd 的 null 选择）
  const selectedWorktreeMap = useAtomValue(agentSelectedWorktreeAtom)
  const setSelectedWorktreeMap = useSetAtom(agentSelectedWorktreeAtom)
  const session = sessions.find((s) => s.id === sessionId)
  const persistedWorktreePath = session?.activeWorktree?.path ?? null
  const selectedWorktreePath = selectedWorktreeMap.has(sessionId)
    ? selectedWorktreeMap.get(sessionId) ?? null
    : persistedWorktreePath
  const diffCacheKey = selectedWorktreePath ? `${sessionId}:worktree:${selectedWorktreePath}` : `${sessionId}:session`

  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId)
  const workspaceSlug = currentWorkspace?.slug

  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null

  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  React.useEffect(() => {
    let disposed = false
    if (!workspaceSlug || !window.electronAPI?.getWorkspaceFilesPath) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI.getWorkspaceFilesPath(workspaceSlug)
      .then((p) => { if (!disposed) setWorkspaceFilesPath(p) })
      .catch(() => { if (!disposed) setWorkspaceFilesPath(null) })
    return () => { disposed = true }
  }, [workspaceSlug])

  const repoPathsMemo = React.useMemo(
    () => [sessionPath, workspaceFilesPath].filter(Boolean) as string[],
    [sessionPath, workspaceFilesPath],
  )

  // 改动数据读取与共享加载/失败状态（不使用 sessionId 猜测回退）
  const diffDataMap = useAtomValue(agentDiffDataAtom)
  const diffStatusMap = useAtomValue(agentDiffStatusAtom)
  const setDiffRefreshVersion = useSetAtom(agentDiffRefreshVersionAtom)
  const diffResult = diffDataMap.get(diffCacheKey)
  const nonGitChanges = useAtomValue(agentNonGitFileChangesAtom).get(sessionId) ?? null

  const diffStatus = diffStatusMap.get(diffCacheKey)
  const isLoading = (diffStatus?.loading === true) && !diffResult
  const error = (!diffResult && diffStatus?.error) ? diffStatus.error : null

  const handleRetry = React.useCallback(() => {
    setDiffRefreshVersion((prev) => {
      const next = new Map(prev)
      next.set(sessionId, Date.now())
      return next
    })
  }, [sessionId, setDiffRefreshVersion])

  const handleWorktreeSelect = React.useCallback(async (worktree: WorktreeInfo | null) => {
    try {
      const updated = await window.electronAPI.setAgentSessionActiveWorktree({
        sessionId,
        worktreePath: worktree?.path ?? null,
      })
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)))
      setSelectedWorktreeMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, updated.activeWorktree?.path ?? null)
        return next
      })
    } catch (error) {
      console.error('[OnDemandChanges] 切换 worktree 失败:', error)
    }
  }, [sessionId, setSelectedWorktreeMap, setSessions])

  // 整理扁平改动列表 (包含非 Git 文件变更降级)
  const allFiles = React.useMemo<FlattenedChangeFile[]>(() => {
    if (diffResult?.isGitRepo === false || (!diffResult && nonGitChanges && nonGitChanges.length > 0)) {
      return (nonGitChanges ?? []).map((c) => ({
        filePath: c.path,
        status: 'modified',
        additions: 0,
        deletions: 0,
      }))
    }
    if (!diffResult) return []
    const tracked: FlattenedChangeFile[] = (diffResult.files ?? []).map((f) => ({
      filePath: f.filePath,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      gitRoot: f.gitRoot,
    }))
    const untracked: FlattenedChangeFile[] = (diffResult.untrackedFiles ?? []).map((f) => ({
      filePath: f.filePath,
      status: 'untracked',
      additions: f.additions,
      deletions: f.deletions,
      gitRoot: f.gitRoot,
    }))
    return [...tracked, ...untracked]
  }, [diffResult, nonGitChanges])

  const stats = React.useMemo(() => calculateDiffBadgeStats(diffResult, nonGitChanges), [diffResult, nonGitChanges])

  // 键盘高亮与虚拟列表
  const [selectedIndex, setSelectedIndex] = React.useState<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: allFiles.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // 打开具体改动直达 S2（带完整 gitRoot、baseRef 与 sessionPath）
  const handleOpenItem = React.useCallback((file: FlattenedChangeFile) => {
    const targetFile: PreviewFile = {
      filePath: file.filePath,
      gitRoot: file.gitRoot,
      baseRef: selectedWorktreePath ? 'origin/main' : undefined,
      dirPath: selectedWorktreePath ?? file.gitRoot ?? currentWorkspace?.projectRootPath ?? sessionPath ?? undefined,
      previewOnly: file.status === 'untracked' || diffResult?.isGitRepo === false,
    }

    openInBigPanel({
      tab: 'changes',
      target: targetFile,
    })
    onItemSelect?.()
  }, [openInBigPanel, onItemSelect, selectedWorktreePath, sessionPath, currentWorkspace?.projectRootPath, diffResult?.isGitRepo])

  // 键盘导航
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (allFiles.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => {
        const next = Math.min(allFiles.length - 1, prev + 1)
        rowVirtualizer.scrollToIndex(next, { align: 'auto' })
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => {
        const next = Math.max(0, prev - 1)
        rowVirtualizer.scrollToIndex(next, { align: 'auto' })
        return next
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = allFiles[selectedIndex]
      if (target) handleOpenItem(target)
    }
  }, [allFiles, handleOpenItem, rowVirtualizer, selectedIndex])

  // 自动聚焦列表容器
  React.useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.focus()
    })
  }, [])

  return (
    <div
      className="flex h-full min-h-0 flex-col outline-none"
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="代码改动快捷面板"
    >
      {/* 顶部紧凑 Worktree 选择器（传入真实 repoPaths） */}
      {workspaceSlug && (
        <div className="shrink-0 border-b border-border/40 px-3 py-1.5 bg-muted/20">
          <WorktreeSelector
            sessionId={sessionId}
            workspaceSlug={workspaceSlug}
            repoPaths={repoPathsMemo}
            selectedPath={selectedWorktreePath}
            onSelect={handleWorktreeSelect}
          />
        </div>
      )}

      {/* 汇总行：“本会话 N 个文件 +x −y” */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2 text-xs">
        <span className="font-medium text-foreground">
          本会话 {allFiles.length} 个文件
        </span>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
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
          {stats.additions === 0 && stats.deletions === 0 && stats.totalFiles > 0 && (
            <span className={diffBadgeClasses.neutral}>
              {stats.totalFiles}
            </span>
          )}
        </div>
      </div>

      {/* 改动列表 (支持 1181+ 真正虚拟滚动) */}
      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        data-testid="on-demand-changes-scroll"
      >
        {isLoading ? (
          <div className="space-y-1.5 p-2 animate-pulse" data-testid="on-demand-changes-skeleton">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex h-7 items-center gap-2 rounded-md bg-muted/30 px-2">
                <div className="size-3.5 rounded bg-muted/60" />
                <div className="h-3 w-28 rounded bg-muted/60" />
                <div className="ml-auto h-3 w-12 rounded bg-muted/40" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-36 flex-col items-center justify-center gap-2 p-4 text-center text-xs" data-testid="on-demand-changes-error">
            <span className="text-destructive font-medium">{error}</span>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors active:scale-[0.97]"
            >
              重试获取
            </button>
          </div>
        ) : allFiles.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            暂无改动
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="代码改动文件列表"
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
            data-testid="on-demand-changes-virtual-container"
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const file = allFiles[virtualRow.index]
              if (!file) return null
              const isSelected = virtualRow.index === selectedIndex
              const lastSlash = Math.max(file.filePath.lastIndexOf('/'), file.filePath.lastIndexOf('\\'))
              const fileName = lastSlash >= 0 ? file.filePath.slice(lastSlash + 1) : file.filePath
              const dirPath = lastSlash >= 0 ? file.filePath.slice(0, lastSlash) : ''

              const statusTag =
                file.status === 'untracked'
                  ? 'U'
                  : file.status === 'deleted'
                    ? 'D'
                    : file.status === 'added'
                      ? 'A'
                      : 'M'

              const statusColor =
                file.status === 'untracked'
                  ? diffBadgeClasses.untracked
                  : file.status === 'deleted'
                    ? diffBadgeClasses.deletion
                    : diffBadgeClasses.neutral

              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleOpenItem(file)}
                    onMouseEnter={() => setSelectedIndex(virtualRow.index)}
                    className={cn(
                      'group flex h-full w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                      isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60 text-muted-foreground',
                    )}
                    role="option"
                    aria-selected={isSelected}
                  >
                    {/* 状态标记 */}
                    <span className={cn('w-3.5 shrink-0 text-center text-[11px]', statusColor)}>
                      {statusTag}
                    </span>

                    {/* 文件名与短路径 */}
                    <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                      <span className="shrink-0 font-mono text-foreground font-normal truncate max-w-[140px]">
                        {fileName}
                      </span>
                      {dirPath && (
                        <span className="truncate text-[10px] text-muted-foreground/70">
                          {dirPath}
                        </span>
                      )}
                    </div>

                    {/* 逐文件增删统计 */}
                    <div className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                      {file.additions > 0 && (
                        <span className={diffBadgeClasses.addition}>
                          +{file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className={diffBadgeClasses.deletion}>
                          -{file.deletions}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
