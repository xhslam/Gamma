import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  ListTree,
  Loader2,
  FilePlus,
  FolderPlus,
  ChevronsDownUp,
  X,
  Search,
} from 'lucide-react'
import type { MarkdownWorkspaceContext, MarkdownWorkspaceEntry, MarkdownWorkspaceSource } from '@gamma/shared'
import type { MarkdownOutlineEntry } from './markdown-reading-tools'
import {
  markdownExpandedFoldersAtom,
  markdownSidebarViewModeAtom,
} from '../../atoms/markdown-workspace-atoms'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { FadeTitle } from '@/components/ui/fade-title'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

export interface MarkdownDocumentListProps {
  id?: string
  context: MarkdownWorkspaceContext
  sources: MarkdownWorkspaceSource[]
  activePath?: string
  activeSourceId?: string
  outlineEntries?: MarkdownOutlineEntry[]
  onOpen: (sourceId: string, path: string) => void
  onAddFolder?: () => void
  onOpenProject?: () => void
  onReleaseSource?: (sourceId: string) => void
  onCreateFile?: (sourceId: string, path: string, name: string) => void
  onJumpOutline?: (entry: MarkdownOutlineEntry) => void
  onError: (reason: string) => void
}

export function MarkdownDocumentList(props: MarkdownDocumentListProps): React.ReactElement {
  const viewMode = useAtomValue(markdownSidebarViewModeAtom)
  const [expandedArray, setExpandedArray] = useAtom(markdownExpandedFoldersAtom)
  const expanded = React.useMemo(() => new Set(expandedArray), [expandedArray])

  const [filter, setFilter] = React.useState('')
  const [entries, setEntries] = React.useState<Record<string, MarkdownWorkspaceEntry[]>>({})
  const [loading, setLoading] = React.useState<Set<string>>(new Set())

  // 新建文件对话框状态
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [createTarget, setCreateTarget] = React.useState<{ sourceId: string; path: string; name: string } | null>(null)
  const [newFileName, setNewFileName] = React.useState('')

  const scope = JSON.stringify(props.context)

  const load = React.useCallback(async (sourceId: string, path: string) => {
    const key = sourceId + ':' + path
    if (loading.has(key)) return
    setLoading(current => new Set(current).add(key))
    try {
      const result = await window.electronAPI.markdownWorkspace({ ...props.context, action: 'list', sourceId, path })
      if (result.status === 'entries') {
        setEntries(current => ({ ...current, [key]: result.entries }))
      } else if (result.status === 'error') {
        props.onError(result.message)
      }
    } catch {
      props.onError('目录读取失败。')
    } finally {
      setLoading(current => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }, [props, loading])

  // 恢复已展开文件夹的条目
  React.useEffect(() => {
    for (const key of expandedArray) {
      const sep = key.indexOf(':')
      if (sep !== -1) {
        const sourceId = key.slice(0, sep)
        const path = key.slice(sep + 1)
        if (props.sources.some(s => s.id === sourceId) && !entries[key]) {
          void load(sourceId, path)
        }
      }
    }
  }, [props.sources, expandedArray, load, entries])

  const toggle = (id: string, path: string) => {
    const key = id + ':' + path
    if (expanded.has(key)) {
      setExpandedArray(current => current.filter(k => k !== key))
    } else {
      setExpandedArray(current => [...current, key])
      if (!entries[key]) {
        void load(id, path)
      }
    }
  }

  const collapseAll = () => {
    setExpandedArray([])
  }

  const promptCreateFile = (sourceId: string, path: string) => {
    setCreateTarget({ sourceId, path, name: '' })
    setNewFileName('Untitled.md')
    setCreateDialogOpen(true)
  }

  const handleCreateSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!createTarget) return
    let name = newFileName.trim()
    if (!name) name = 'Untitled.md'
    if (!name.toLowerCase().endsWith('.md') && !name.toLowerCase().endsWith('.markdown')) {
      name += '.md'
    }
    setCreateDialogOpen(false)
    props.onCreateFile?.(createTarget.sourceId, createTarget.path, name)
    // 确保父目录已展开并刷新
    const key = createTarget.sourceId + ':' + createTarget.path
    if (!expanded.has(key)) {
      setExpandedArray(current => [...current, key])
    }
    void load(createTarget.sourceId, createTarget.path)
  }

  const renderTree = (id: string, path: string, depth: number): React.ReactNode => {
    const key = id + ':' + path
    if (!expanded.has(key)) return null

    const dirEntries = entries[key]
    if (!dirEntries) {
      return loading.has(key) ? (
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground" style={{ paddingLeft: 12 + depth * 14 }}>
          <Loader2 className="size-3 animate-spin" />
          <span>正在读取…</span>
        </div>
      ) : null
    }

    const filtered = dirEntries.filter(
      entry => entry.kind === 'directory' || !filter || entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    )

    if (filtered.length === 0) {
      return (
        <div className="px-3 py-1 text-xs text-muted-foreground/60 italic" style={{ paddingLeft: 12 + depth * 14 }}>
          空目录
        </div>
      )
    }

    return filtered.map(entry => {
      const isDir = entry.kind === 'directory'
      const itemKey = id + ':' + entry.path
      const isExpanded = expanded.has(itemKey)
      const isActive = !isDir && props.activeSourceId === id && props.activePath === entry.path

      return (
        <div key={entry.path} className="group/item">
          <div
            className={`flex items-center justify-between rounded-md pr-1.5 transition-colors hover:bg-muted/70 ${isActive ? 'bg-accent text-accent-foreground font-medium' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <Button data-disclosure-trigger="" aria-expanded={isDir ? isExpanded : undefined}
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-xs font-normal hover:bg-transparent"
              onClick={() => isDir ? toggle(id, entry.path) : props.onOpen(id, entry.path)}
            >
              {isDir ? (
                <>
                  <DisclosureChevron expanded={isExpanded} size={12} className={`size-3 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
                </>
              ) : (
                <FileText className={`size-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              )}
              <FadeTitle className="truncate">{entry.name}</FadeTitle>
            </Button>

            {isDir && (
              <Button
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity hover:bg-accent"
                title="在此目录新建文件"
                aria-label="新建文件"
                onClick={e => {
                  e.stopPropagation()
                  promptCreateFile(id, entry.path)
                }}
              >
                <FilePlus className="size-3 text-muted-foreground" />
              </Button>
            )}
          </div>

          {isDir && renderTree(id, entry.path, depth + 1)}
        </div>
      )
    })
  }

  return (
    <aside
      id={props.id}
      className="markdown-sidebar flex w-64 shrink-0 flex-col overflow-hidden border-r bg-card/40 text-card-foreground select-none"
      aria-label="Markdown 文件来源"
    >
      {/* 视图由底部统一切换；顶部仅显示标题与当前视图的操作。 */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3" role="toolbar" aria-label="Markdown 侧栏工具栏">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {viewMode === 'files' ? <FolderTree className="size-3.5 shrink-0" /> : <ListTree className="size-3.5 shrink-0" />}
          <span className="truncate">{viewMode === 'files' ? '文件' : '大纲'}</span>
        </div>

        {viewMode === 'files' && (
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex items-center gap-0.5">
              {props.sources.some(s => s.kind === 'directory') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title="新建文件"
                  aria-label="新建 Markdown 文件"
                  onClick={() => {
                    const firstDir = props.sources.find(s => s.kind === 'directory')
                    if (firstDir) promptCreateFile(firstDir.id, '')
                  }}
                >
                  <FilePlus className="size-3.5" />
                </Button>
              )}
              {props.onAddFolder && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title="添加文件夹"
                  aria-label="添加文件夹"
                  onClick={props.onAddFolder}
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="ml-0.5 border-l pl-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title="全部折叠"
                aria-label="折叠全部目录"
                onClick={collapseAll}
              >
                <ChevronsDownUp className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 视图内容：文件树模式 */}
      {viewMode === 'files' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 筛选输入框 */}
          <div className="p-2 pb-1.5">
            <div className="relative flex items-center">
              <Search className="absolute left-2 size-3 text-muted-foreground pointer-events-none" />
              <Input
                className="h-7 pl-7 pr-6 text-xs bg-muted/40 border-muted"
                aria-label="筛选已展开目录中的文件"
                placeholder="筛选已展开的文件…"
                value={filter}
                onChange={event => setFilter(event.target.value)}
              />
              {filter && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 size-5 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setFilter('')}
                  aria-label="清除筛选"
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          </div>

          {/* 来源树 */}
          <div className="flex-1 overflow-y-auto px-1.5 py-1">
            {props.sources.map(source => {
              const isDir = source.kind === 'directory'
              const rootKey = source.id + ':'
              const isExpanded = expanded.has(rootKey)

              return (
                <div key={source.id} className="group/root mb-1">
                  <div className="flex items-center justify-between rounded-md pr-1 hover:bg-muted/70">
                    <Button data-disclosure-trigger="" aria-expanded={isDir ? isExpanded : undefined}
                      variant="ghost"
                      size="sm"
                      className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-xs font-semibold hover:bg-transparent"
                      onClick={() => isDir ? toggle(source.id, '') : props.onOpen(source.id, '')}
                    >
                      {loading.has(rootKey) ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      ) : isDir ? (
                        <>
                          <DisclosureChevron expanded={isExpanded} size={12} className={`size-3 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <Folder className="size-3.5 shrink-0 text-primary" />}
                        </>
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <FadeTitle className="truncate">{source.name}</FadeTitle>
                    </Button>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover/root:opacity-100 transition-opacity">
                      {isDir && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 hover:bg-accent"
                          title="在根目录新建文件"
                          aria-label="新建文件"
                          onClick={e => {
                            e.stopPropagation()
                            promptCreateFile(source.id, '')
                          }}
                        >
                          <FilePlus className="size-3 text-muted-foreground" />
                        </Button>
                      )}
                      {props.onReleaseSource && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 hover:bg-destructive/20 hover:text-destructive"
                          title="移除此文件夹"
                          aria-label="移除文件夹"
                          onClick={e => {
                            e.stopPropagation()
                            props.onReleaseSource?.(source.id)
                          }}
                        >
                          <X className="size-3" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {isDir && renderTree(source.id, '', 1)}
                </div>
              )
            })}

            {props.sources.length === 0 && (
              <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground gap-3">
                <FolderOpen className="size-8 stroke-[1.5] text-muted-foreground/40" />
                <div>
                  <p className="font-medium text-foreground/80">未挂载文件夹</p>
                  <p className="mt-1 text-muted-foreground/70">打开文件、目录或当前项目以开始阅读与写作。</p>
                </div>
                <div className="flex flex-col gap-1.5 w-full mt-2">
                  {props.onAddFolder && (
                    <Button variant="secondary" size="sm" className="h-7 text-xs w-full" onClick={props.onAddFolder}>
                      添加文件夹
                    </Button>
                  )}
                  {props.onOpenProject && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={props.onOpenProject}>
                      打开当前项目
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 视图内容：目录大纲模式 */}
      {viewMode === 'outline' && (
        <div className="flex-1 overflow-y-auto p-2">
          {!props.outlineEntries || props.outlineEntries.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">当前文档暂无标题大纲</p>
          ) : (
            props.outlineEntries.map(entry => (
              <Button
                key={entry.offset}
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                style={{ paddingLeft: 8 + (entry.depth - 1) * 12 }}
                onClick={() => props.onJumpOutline?.(entry)}
              >
                <span className="truncate">{entry.text || '未命名标题'}</span>
              </Button>
            ))
          )}
        </div>
      )}

      {/* 新建文件弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">新建 Markdown 文件</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-3 py-2">
            <Input
              autoFocus
              className="h-8 text-xs"
              placeholder="例如：my-note.md"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCreateDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" size="sm" className="h-7 text-xs">
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
