/**
 * OnDemandFilesContent — S1 文件按需浮层内容
 *
 * 包含与既有 SidePanel 一致的真实项目根/会话根和附加目录：
 * - 顶部项目文件/会话文件分段切换
 * - 递归展开复用同一逻辑（根目录、附加目录、孙目录及深层子目录）
 * - 监听 workspaceFilesVersionAtom 自动刷新根目录与已展开子目录
 * - 明确区分加载骨架、加载失败与空态，managed 根目录未 resolve 时显示骨架
 * - 搜索与 FileSearchBar 对齐（传递 additionalPaths，解析绝对路径并保留相对路径显示）
 * - 点击文件直达 S2 预览（完整 PreviewFile 元数据与权限约定）
 * - 虚拟滚动支持千项文件极速呈现
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, X, ChevronRight, ChevronDown, Folder, Paperclip, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  agentAttachedFilesMapAtom,
  agentAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentSessionPathMapAtom,
  agentWorkspacesAtom,
  workspaceFilesVersionAtom,
} from '@/atoms/agent-atoms'
import type { PreviewFile } from '@/atoms/preview-atoms'
import { openInBigPanelAtom } from '@/atoms/on-demand-panel-atoms'
import { FileTypeIcon } from '@/components/file-browser/FileTypeIcon'
import type { FileEntry } from '@gamma/shared'

interface OnDemandFilesContentProps {
  sessionId?: string
  onItemSelect?: () => void
}

export type FileScope = 'project' | 'session'

interface FlatFileItem {
  id: string
  name: string
  path: string
  displayPath?: string
  isDirectory: boolean
  depth: number
  isAttached?: boolean
  isExpanded?: boolean
  scope: FileScope
}

const ROW_HEIGHT = 28

export function OnDemandFilesContent({
  sessionId: propSessionId,
  onItemSelect,
}: OnDemandFilesContentProps): React.ReactElement {
  const currentId = useAtomValue(currentAgentSessionIdAtom) ?? ''
  const sessionId = propSessionId || currentId
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId)
  const workspaceSlug = currentWorkspace?.slug

  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null
  const workspaceFilesVersion = useAtomValue(workspaceFilesVersionAtom)

  const openInBigPanel = useSetAtom(openInBigPanelAtom)

  // 1. 分段选择：项目文件 vs 会话文件
  const [activeScope, setActiveScope] = React.useState<FileScope>('project')

  // 2. 真实工作区根路径解析
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

  // 附加文件与目录
  const sessionAttachedFiles = useAtomValue(agentAttachedFilesMapAtom).get(sessionId) ?? []
  const sessionAttachedDirs = useAtomValue(agentAttachedDirectoriesMapAtom).get(sessionId) ?? []
  const projectAttachedFilesMap = useAtomValue(workspaceAttachedFilesMapAtom)
  const projectAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const projectAttachedFiles = projectAttachedFilesMap.get(workspaceId ?? '') ?? []
  const projectAttachedDirs = projectAttachedDirsMap.get(workspaceId ?? '') ?? []

  // 会话文件访问上下文
  const fileAccess = React.useMemo(() => ({ sessionId, unrestricted: true }), [sessionId])

  // 3. 搜索与加载状态
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<FlatFileItem[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [isLoadingRoot, setIsLoadingRoot] = React.useState(true)
  const [rootError, setRootError] = React.useState<string | null>(null)
  const [refreshTick, setRefreshTick] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 4. 目录展开与子树缓存
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(new Set())
  const [dirEntriesMap, setDirEntriesMap] = React.useState<Map<string, FileEntry[]>>(new Map())
  const [rootEntries, setRootEntries] = React.useState<FileEntry[]>([])

  // 打开自动聚焦搜索框
  React.useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  // 当前激活 Scope 的根目录
  const currentRootPath = activeScope === 'project' ? workspaceFilesPath : sessionPath
  const isManagedResolving = activeScope === 'project' && Boolean(workspaceSlug) && workspaceFilesPath === null

  // 加载当前 Scope 的根目录文件列表（响应 workspaceFilesVersion 刷新信号）
  React.useEffect(() => {
    let disposed = false
    if (!currentRootPath || !window.electronAPI?.listDirectory) {
      setRootEntries([])
      setIsLoadingRoot(false)
      setRootError(null)
      return
    }

    setIsLoadingRoot(true)
    setRootError(null)

    window.electronAPI.listDirectory(currentRootPath, fileAccess)
      .then((entries) => {
        if (!disposed) {
          setRootEntries(entries || [])
          setIsLoadingRoot(false)
          setRootError(null)
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err)
          setRootError(msg || '加载目录列表失败')
          setRootEntries([])
          setIsLoadingRoot(false)
        }
      })

    return () => { disposed = true }
  }, [currentRootPath, fileAccess, workspaceFilesVersion, refreshTick])

  // 刷新所有已展开目录的子项（当收到版本更新时）
  React.useEffect(() => {
    if (!window.electronAPI?.listDirectory || expandedDirs.size === 0) return
    let disposed = false

    for (const dirPath of expandedDirs) {
      window.electronAPI.listDirectory(dirPath, fileAccess)
        .then((children) => {
          if (!disposed && children) {
            setDirEntriesMap((prev) => new Map(prev).set(dirPath, children))
          }
        })
        .catch(() => {})
    }

    return () => { disposed = true }
  }, [workspaceFilesVersion, expandedDirs, fileAccess])

  // 展开文件夹并加载子项（复用同一逻辑，支持根、附加目录、孙目录及深层子目录）
  const toggleDirExpand = React.useCallback(async (dirPath: string) => {
    const isExpanded = expandedDirs.has(dirPath)
    if (isExpanded) {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
      return
    }

    setExpandedDirs((prev) => new Set(prev).add(dirPath))
    if (!dirEntriesMap.has(dirPath) && window.electronAPI?.listDirectory) {
      try {
        const children = await window.electronAPI.listDirectory(dirPath, fileAccess)
        setDirEntriesMap((prev) => new Map(prev).set(dirPath, children || []))
      } catch {
        setDirEntriesMap((prev) => new Map(prev).set(dirPath, []))
      }
    }
  }, [expandedDirs, dirEntriesMap, fileAccess])

  // 执行搜索（对齐 FileSearchBar：传递 additionalPaths，解析绝对路径并区分加载/失败/空态）
  React.useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults([])
      setIsSearching(false)
      setSearchError(null)
      return
    }

    let disposed = false
    setIsSearching(true)
    setSearchError(null)

    const timer = setTimeout(async () => {
      try {
        const targetPath = activeScope === 'project' ? workspaceFilesPath : sessionPath
        const additionalPaths = activeScope === 'project'
          ? (projectAttachedDirs.length > 0 ? projectAttachedDirs : undefined)
          : (sessionAttachedDirs.length > 0 ? sessionAttachedDirs : undefined)

        if (targetPath && window.electronAPI?.searchWorkspaceFiles) {
          const res = await window.electronAPI.searchWorkspaceFiles(targetPath, q, 50, additionalPaths)
          if (disposed) return
          const entries = res.entries || []
          const items: FlatFileItem[] = entries.map((e) => {
            const sep = targetPath.includes('\\') && !targetPath.includes('/') ? '\\' : '/'
            const absPath = e.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(e.path)
              ? e.path
              : `${targetPath.replace(/[\\/]+$/, '')}${sep}${e.path}`
            return {
              id: `search-${absPath}`,
              name: e.name,
              path: absPath,
              displayPath: e.path,
              isDirectory: e.type === 'dir',
              depth: 0,
              scope: activeScope,
            }
          })
          setSearchResults(items)
        } else {
          // 本地快速过滤兜底
          const localItems: FlatFileItem[] = []
          const searchInEntries = (list: FileEntry[]) => {
            for (const item of list) {
              if (item.name.toLowerCase().includes(q.toLowerCase())) {
                localItems.push({
                  id: `local-${item.path}`,
                  name: item.name,
                  path: item.path,
                  displayPath: item.name,
                  isDirectory: item.isDirectory,
                  depth: 0,
                  scope: activeScope,
                })
              }
              if (item.children) searchInEntries(item.children)
            }
          }
          searchInEntries(rootEntries)
          if (!disposed) setSearchResults(localItems)
        }
      } catch (err: unknown) {
        if (!disposed) {
          setSearchError(err instanceof Error ? err.message : '搜索失败')
          setSearchResults([])
        }
      } finally {
        if (!disposed) setIsSearching(false)
      }
    }, 150)

    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [searchQuery, activeScope, workspaceFilesPath, sessionPath, projectAttachedDirs, sessionAttachedDirs, rootEntries])

  // 递归生成树状扁平数组（复用同一逻辑，无论根目录、附加目录或子/孙目录）
  const visibleRows = React.useMemo<FlatFileItem[]>(() => {
    if (searchQuery.trim()) {
      return searchResults
    }

    const rows: FlatFileItem[] = []
    const attachedFiles = activeScope === 'project' ? projectAttachedFiles : sessionAttachedFiles
    const attachedDirs = activeScope === 'project' ? projectAttachedDirs : sessionAttachedDirs

    // 通用递归构建树函数
    const appendEntriesRecursive = (entries: FileEntry[], depth: number) => {
      for (const entry of entries) {
        // 根层级去重（如果已被附加列表展示）
        if (depth === 0 && (attachedFiles.includes(entry.path) || attachedDirs.includes(entry.path))) {
          continue
        }

        const isExpanded = expandedDirs.has(entry.path)
        rows.push({
          id: `entry-${entry.path}`,
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          depth,
          isExpanded,
          scope: activeScope,
        })

        if (entry.isDirectory && isExpanded) {
          const children = dirEntriesMap.get(entry.path) ?? entry.children ?? []
          appendEntriesRecursive(children, depth + 1)
        }
      }
    }

    // 1. 附加目录（作为深度 0 目录展示，展开后递归 append 子项与孙目录）
    for (const d of attachedDirs) {
      const name = d.split(/[\\/]/).filter(Boolean).pop() || d
      const isExpanded = expandedDirs.has(d)
      rows.push({
        id: `attached-dir-${d}`,
        name,
        path: d,
        isDirectory: true,
        depth: 0,
        isAttached: true,
        isExpanded,
        scope: activeScope,
      })

      if (isExpanded) {
        const children = dirEntriesMap.get(d) ?? []
        appendEntriesRecursive(children, 1)
      }
    }

    // 2. 附加文件
    for (const f of attachedFiles) {
      const name = f.split(/[\\/]/).filter(Boolean).pop() || f
      rows.push({
        id: `attached-file-${f}`,
        name,
        path: f,
        isDirectory: false,
        depth: 0,
        isAttached: true,
        scope: activeScope,
      })
    }

    // 3. 根目录文件树（递归展示）
    appendEntriesRecursive(rootEntries, 0)

    return rows
  }, [
    searchQuery,
    searchResults,
    activeScope,
    projectAttachedFiles,
    sessionAttachedFiles,
    projectAttachedDirs,
    sessionAttachedDirs,
    expandedDirs,
    dirEntriesMap,
    rootEntries,
  ])

  // 虚拟滚动与键盘高亮
  const [selectedIndex, setSelectedIndex] = React.useState<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  React.useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery, activeScope])

  // 打开或展开条目
  const handleItemClick = React.useCallback(
    (item: FlatFileItem) => {
      if (item.isDirectory) {
        // 目录：原位展开/折叠，不直接弹大面板
        toggleDirExpand(item.path)
        return
      }

      // 文件：真正创建文件预览直达 S2（带完整 PreviewFile 元数据）
      const basePaths = [sessionPath, workspaceFilesPath].filter(Boolean) as string[]
      const previewFile: PreviewFile = {
        filePath: item.path,
        dirPath: currentRootPath ?? undefined,
        previewOnly: true,
        unrestricted: true,
        basePaths: basePaths.length > 0 ? basePaths : undefined,
      }

      openInBigPanel({
        tab: 'files',
        target: previewFile,
      })
      onItemSelect?.()
    },
    [toggleDirExpand, sessionPath, workspaceFilesPath, currentRootPath, openInBigPanel, onItemSelect],
  )

  // 键盘导航
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleRows.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => {
          const next = Math.min(visibleRows.length - 1, prev + 1)
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
        const item = visibleRows[selectedIndex]
        if (item) handleItemClick(item)
      }
    },
    [handleItemClick, rowVirtualizer, selectedIndex, visibleRows],
  )

  const isInitialLoading = isManagedResolving || (isLoadingRoot && visibleRows.length === 0)

  return (
    <div
      className="flex h-full min-h-0 flex-col outline-none"
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="文件快捷面板"
    >
      {/* 1. 分段选择器：项目文件 / 会话文件 */}
      <div className="flex border-b border-border/40 bg-muted/20 p-1 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveScope('project')}
          className={cn(
            'flex-1 rounded py-1 text-center text-xs transition-colors',
            activeScope === 'project'
              ? 'bg-background font-medium text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label="切换至项目文件"
        >
          项目文件
        </button>
        <button
          type="button"
          onClick={() => setActiveScope('session')}
          className={cn(
            'flex-1 rounded py-1 text-center text-xs transition-colors',
            activeScope === 'session'
              ? 'bg-background font-medium text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label="切换至会话文件"
        >
          会话文件
        </button>
      </div>

      {/* 2. 搜索框 (打开自动聚焦) */}
      <div className="shrink-0 border-b border-border/40 p-2">
        <div className="relative flex items-center">
          {isSearching ? (
            <Loader2 className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground animate-spin" />
          ) : (
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`搜索${activeScope === 'project' ? '项目' : '会话'}文件...`}
            className="h-8 w-full rounded-md bg-muted/40 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/70 focus:ring-1 focus:ring-primary/40 transition-all"
            aria-label="搜索文件"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                inputRef.current?.focus()
              }}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* 3. 列表区 (支持虚拟滚动、骨架屏、错误提示与空态区分) */}
      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        data-testid="on-demand-files-scroll"
      >
        {isInitialLoading ? (
          // 骨架屏：避免未加载或 managed 路径未解析时误闪“暂无文件”
          <div className="space-y-1.5 p-2 animate-pulse" data-testid="on-demand-files-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex h-6 items-center gap-2 rounded-md bg-muted/30 px-2">
                <div className="size-3.5 rounded bg-muted/60" />
                <div className={cn('h-3 rounded bg-muted/60', i % 2 === 0 ? 'w-36' : 'w-24')} />
              </div>
            ))}
          </div>
        ) : searchError ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1.5 p-4 text-center text-xs text-destructive">
            <span>{searchError}</span>
          </div>
        ) : rootError && visibleRows.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 p-4 text-center text-xs" data-testid="on-demand-files-error">
            <span className="text-destructive font-medium">{rootError}</span>
            <button
              type="button"
              onClick={() => setRefreshTick((t) => t + 1)}
              className="rounded border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors active:scale-[0.97]"
            >
              重试加载
            </button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            {searchQuery ? '未找到匹配文件' : '暂无文件'}
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="文件树列表"
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
            data-testid="on-demand-files-virtual-container"
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = visibleRows[virtualRow.index]
              if (!item) return null
              const isSelected = virtualRow.index === selectedIndex

              return (
                <div
                  key={item.id}
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
                    onClick={() => handleItemClick(item)}
                    onMouseEnter={() => setSelectedIndex(virtualRow.index)}
                    style={{ paddingLeft: `${item.depth * 14 + 6}px` }}
                    className={cn(
                      'group flex h-full w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs transition-colors',
                      isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60 text-muted-foreground',
                    )}
                    role="option"
                    aria-selected={isSelected}
                  >
                    {item.isDirectory ? (
                      <>
                        <span className="flex size-4 items-center justify-center text-muted-foreground/70">
                          {item.isExpanded ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                        </span>
                        <Folder className="size-3.5 shrink-0 text-primary/70" />
                      </>
                    ) : (
                      <>
                        <span className="w-4 shrink-0" />
                        <FileTypeIcon name={item.name} isDirectory={false} className="size-3.5 shrink-0" />
                      </>
                    )}

                    <span className="truncate font-mono text-foreground text-xs font-normal">
                      {item.name}
                    </span>

                    {item.displayPath && item.displayPath !== item.name && (
                      <span className="truncate text-[10px] text-muted-foreground/60 max-w-[150px]">
                        {item.displayPath}
                      </span>
                    )}

                    {item.isAttached && (
                      <span className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground/70 shrink-0">
                        <Paperclip className="size-2.5" />
                        附加
                      </span>
                    )}
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
