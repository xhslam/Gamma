/**
 * ConversationReferenceDialog — 会话引用多选选择器
 *
 * 两级结构（项目 -> 对话），当前项目优先展示，支持跨项目搜索与多选。
 * 支持键盘导航（上下光标、Enter 切换选择、Esc 关闭）。
 * 展示会话标题、更新时间、消息数与首句预览。
 * 限制最多同时引用 5 个会话，杜绝自引用与重复引用。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  Search,
  X,
  MessageSquareText,
  Check,
  FolderGit2,
  Calendar,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { agentSessionsAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import type { AgentContextRef, AgentContextRefDetail, AgentWorkspace, AgentSessionMeta } from '@gamma/shared'
import { toast } from 'sonner'

/** 最大可引用会话数常量 */
export const MAX_CONTEXT_REFS = 5

export interface ConversationReferenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSessionId: string
  currentWorkspaceId?: string
  initialRefs: AgentContextRef[]
  onConfirm: (refs: AgentContextRef[]) => void | Promise<void>
}

interface FlattenedItem {
  type: 'header' | 'session'
  id: string
  workspaceId?: string
  workspaceName?: string
  session?: AgentSessionMeta
}

/** 格式化更新相对时间 */
function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

export function ConversationReferenceDialog({
  open,
  onOpenChange,
  currentSessionId,
  currentWorkspaceId,
  initialRefs,
  onConfirm,
}: ConversationReferenceDialogProps): React.ReactElement {
  const allSessions = useAtomValue(agentSessionsAtom)
  const allWorkspaces = useAtomValue(agentWorkspacesAtom)

  const [query, setQuery] = React.useState('')
  const [selectedMap, setSelectedMap] = React.useState<Map<string, AgentContextRef>>(new Map())
  const [highlightedIndex, setHighlightedIndex] = React.useState(0)
  const [detailsCache, setDetailsCache] = React.useState<Record<string, AgentContextRefDetail>>({})
  const listRef = React.useRef<HTMLDivElement>(null)

  // 对话框打开时同步初始引用
  React.useEffect(() => {
    if (open) {
      setQuery('')
      const map = new Map<string, AgentContextRef>()
      for (const ref of initialRefs) {
        map.set(ref.sourceConversationId, { ...ref })
      }
      setSelectedMap(map)
      setHighlightedIndex(0)
    }
  }, [open, initialRefs])

  // 过滤可引用会话（排除当前会话、草稿会话）
  const eligibleSessions = React.useMemo(() => {
    return allSessions.filter((s) => s.id !== currentSessionId && !s.isDraft && !s.archived)
  }, [allSessions, currentSessionId])

  // 预加载可见会话详情
  React.useEffect(() => {
    if (!open) return
    let active = true

    const toFetch = eligibleSessions
      .slice(0, 30)
      .filter((s) => !detailsCache[s.id])

    if (toFetch.length === 0) return

    Promise.all(
      toFetch.map(async (s) => {
        try {
          const res = await window.electronAPI.getContextRefDetail({ sourceSessionId: s.id })
          return { id: s.id, detail: res.detail }
        } catch {
          return null
        }
      })
    ).then((results) => {
      if (!active) return
      setDetailsCache((prev) => {
        const next = { ...prev }
        for (const item of results) {
          if (item) next[item.id] = item.detail
        }
        return next
      })
    })

    return () => {
      active = false
    }
  }, [open, eligibleSessions, detailsCache])

  // 工作区 Map
  const workspaceMap = React.useMemo(() => {
    const map = new Map<string, AgentWorkspace>()
    for (const ws of allWorkspaces) {
      map.set(ws.id, ws)
    }
    return map
  }, [allWorkspaces])

  // 搜索与两级分组（当前项目优先）
  const { groups, flattenedItems } = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    const filtered = eligibleSessions.filter((s) => {
      if (!normalizedQuery) return true
      const titleMatch = (s.title || '').toLowerCase().includes(normalizedQuery)
      const detail = detailsCache[s.id]
      const previewMatch = (detail?.firstMessagePreview || '').toLowerCase().includes(normalizedQuery)
      const ws = s.workspaceId ? workspaceMap.get(s.workspaceId) : undefined
      const wsMatch = ws ? (ws.name || '').toLowerCase().includes(normalizedQuery) : false
      return titleMatch || previewMatch || wsMatch
    })

    // 按工作区分组
    const currentWsSessions: AgentSessionMeta[] = []
    const otherWsSessions = new Map<string, AgentSessionMeta[]>()
    const defaultWsSessions: AgentSessionMeta[] = []

    for (const s of filtered) {
      if (currentWorkspaceId && s.workspaceId === currentWorkspaceId) {
        currentWsSessions.push(s)
      } else if (s.workspaceId) {
        const list = otherWsSessions.get(s.workspaceId) ?? []
        list.push(s)
        otherWsSessions.set(s.workspaceId, list)
      } else {
        defaultWsSessions.push(s)
      }
    }

    // 组装扁平化列表供渲染与键盘导航
    const flat: FlattenedItem[] = []
    const groupList: Array<{ title: string; isCurrent: boolean; sessions: AgentSessionMeta[] }> = []

    if (currentWsSessions.length > 0) {
      const currentWs = currentWorkspaceId ? workspaceMap.get(currentWorkspaceId) : undefined
      const title = currentWs ? `当前项目：${currentWs.name}` : '当前项目'
      groupList.push({ title, isCurrent: true, sessions: currentWsSessions })
      flat.push({ type: 'header', id: `header-current`, workspaceName: title })
      for (const s of currentWsSessions) {
        flat.push({ type: 'session', id: s.id, session: s })
      }
    }

    for (const [wsId, sessions] of otherWsSessions.entries()) {
      const ws = workspaceMap.get(wsId)
      const title = ws?.name ?? '其他项目'
      groupList.push({ title, isCurrent: false, sessions })
      flat.push({ type: 'header', id: `header-${wsId}`, workspaceName: title })
      for (const s of sessions) {
        flat.push({ type: 'session', id: s.id, session: s })
      }
    }

    if (defaultWsSessions.length > 0) {
      groupList.push({ title: '默认空间', isCurrent: false, sessions: defaultWsSessions })
      flat.push({ type: 'header', id: `header-default`, workspaceName: '默认空间' })
      for (const s of defaultWsSessions) {
        flat.push({ type: 'session', id: s.id, session: s })
      }
    }

    return { groups: groupList, flattenedItems: flat }
  }, [eligibleSessions, query, currentWorkspaceId, workspaceMap, detailsCache])

  // 提取纯 session 项用于键盘高亮索引
  const sessionIndices = React.useMemo(() => {
    const indices: number[] = []
    flattenedItems.forEach((item, index) => {
      if (item.type === 'session') indices.push(index)
    })
    return indices
  }, [flattenedItems])

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (sessionIndices.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => {
        const currentPos = sessionIndices.indexOf(prev)
        const nextPos = currentPos < sessionIndices.length - 1 ? currentPos + 1 : 0
        return sessionIndices[nextPos] ?? prev
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => {
        const currentPos = sessionIndices.indexOf(prev)
        const nextPos = currentPos > 0 ? currentPos - 1 : sessionIndices.length - 1
        return sessionIndices[nextPos] ?? prev
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flattenedItems[highlightedIndex]
      if (target?.type === 'session' && target.session) {
        toggleSelection(target.session)
      }
    }
  }

  // 自动滚动高亮项进视口
  React.useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-flat-index="${highlightedIndex}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  // 切换选择
  const toggleSelection = (session: AgentSessionMeta): void => {
    const isSelected = selectedMap.has(session.id)
    if (isSelected) {
      setSelectedMap((prev) => {
        const next = new Map(prev)
        next.delete(session.id)
        return next
      })
    } else {
      if (selectedMap.size >= MAX_CONTEXT_REFS) {
        toast.warning(`最多同时引用 ${MAX_CONTEXT_REFS} 个对话`)
        return
      }

      const detail = detailsCache[session.id]
      const newRef: AgentContextRef = {
        refId: `ref-${crypto.randomUUID()}`,
        sourceConversationId: session.id,
        sourceProjectId: session.workspaceId ?? '',
        titleAtAttach: session.title || '无标题对话',
        mode: 'snapshot',
        snapshotUpToMessageId: detail?.lastCompleteMessageId,
        snapshotAt: Date.now(),
        messageCount: detail?.messageCount,
        estTokens: detail?.estTokens,
      }

      setSelectedMap((prev) => {
        const next = new Map(prev)
        next.set(session.id, newRef)
        return next
      })
    }
  }

  // 切换模式（快照 / 实时）
  const toggleMode = (sessionId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    const existing = selectedMap.get(sessionId)
    if (!existing) return
    const nextMode = existing.mode === 'live' ? 'snapshot' : 'live'
    setSelectedMap((prev) => {
      const next = new Map(prev)
      next.set(sessionId, { ...existing, mode: nextMode })
      return next
    })
  }

  // 确认保存
  const handleConfirm = async (): Promise<void> => {
    const refs = Array.from(selectedMap.values())
    await onConfirm(refs)
    onOpenChange(false)
  }

  const selectedCount = selectedMap.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <MessageSquareText className="size-4 text-sky-500" />
              <span>引用对话作为背景资料</span>
            </DialogTitle>
            <Badge variant="secondary" className="text-xs font-normal">
              已选 {selectedCount} / {MAX_CONTEXT_REFS}
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            被引用的历史对话将注入上下文辅助解答，不会混入持久历史或被修改。
          </DialogDescription>

          {/* 搜索框 */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlightedIndex(0)
              }}
              placeholder="搜索项目或对话标题、首句预览..."
              className="pl-9 pr-8 h-9 text-xs"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </DialogHeader>

        {/* 对话列表 */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3 min-h-[300px]">
          {flattenedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <MessageSquareText className="size-8 opacity-30 mb-2" />
              <p className="text-sm font-medium">未找到匹配的对话</p>
              <p className="text-xs opacity-75 mt-0.5">请尝试缩短关键词，或查看其他工作区。</p>
            </div>
          ) : (
            flattenedItems.map((item, index) => {
              if (item.type === 'header') {
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground/80"
                  >
                    <FolderGit2 className="size-3.5 text-muted-foreground/60" />
                    <span>{item.workspaceName}</span>
                  </div>
                )
              }

              const session = item.session!
              const isSelected = selectedMap.has(session.id)
              const isHighlighted = highlightedIndex === index
              const currentRef = selectedMap.get(session.id)
              const detail = detailsCache[session.id]

              return (
                <div
                  key={session.id}
                  data-flat-index={index}
                  onClick={() => toggleSelection(session)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    'group relative flex items-start gap-3 p-2.5 rounded-lg border transition-all cursor-pointer select-none text-left',
                    isSelected
                      ? 'border-sky-500/40 bg-sky-500/[0.04]'
                      : 'border-border/60 hover:border-border hover:bg-muted/40',
                    isHighlighted && !isSelected && 'bg-muted/60 border-primary/30',
                    isHighlighted && isSelected && 'border-sky-500/60 bg-sky-500/[0.08]'
                  )}
                >
                  {/* 复选框 */}
                  <div
                    className={cn(
                      'mt-0.5 size-4 rounded border flex items-center justify-center transition-colors flex-shrink-0',
                      isSelected
                        ? 'bg-sky-500 border-sky-500 text-white'
                        : 'border-muted-foreground/40 group-hover:border-muted-foreground/60'
                    )}
                  >
                    {isSelected && <Check className="size-3 stroke-[2.5]" />}
                  </div>

                  {/* 会话内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate text-foreground">
                        {session.title || '无标题会话'}
                      </span>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* 模式选择按钮（选中时可切换） */}
                        {isSelected && currentRef && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => toggleMode(session.id, e)}
                                className={cn(
                                  'text-[10px] px-1.5 py-0.5 rounded border transition-colors font-mono',
                                  currentRef.mode === 'live'
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                )}
                              >
                                {currentRef.mode === 'live' ? '实时' : '快照'}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>{currentRef.mode === 'live' ? '实时模式：每轮读取最新消息' : '快照模式：冻结在当前消息，内容稳定'}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {session.updatedAt && (
                          <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap">
                            {formatTimeAgo(session.updatedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 首句预览 */}
                    {detail?.firstMessagePreview ? (
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                        {detail.firstMessagePreview}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/50 italic mt-0.5">
                        暂无文本预览
                      </p>
                    )}

                    {/* 元数据标签 */}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/60">
                      {detail?.messageCount != null && (
                        <span className="flex items-center gap-1">
                          <Layers className="size-3" />
                          <span>{detail.messageCount} 条消息</span>
                        </span>
                      )}
                      {detail?.estTokens != null && detail.estTokens > 0 && (
                        <span className="flex items-center gap-1">
                          <Sparkles className="size-3" />
                          <span>~{detail.estTokens} tokens</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* 底部按钮栏 */}
        <DialogFooter className="px-5 py-3 border-t border-border/50 flex items-center justify-between sm:justify-between bg-muted/20">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            <span>按 ↑↓ 选择，Enter 勾选，Esc 关闭</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 text-xs"
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              className="h-8 text-xs bg-sky-600 hover:bg-sky-500 text-white"
            >
              确定引用 ({selectedCount})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
