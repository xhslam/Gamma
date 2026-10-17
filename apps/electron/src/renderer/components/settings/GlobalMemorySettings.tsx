/**
 * GlobalMemorySettings — 全局长期记忆管理面板
 *
 * 查看、编辑与删除跨会话的用户长期记忆（profile.md, preferences.md, topics 等）。
 */

import * as React from 'react'
import {
  Brain,
  FileText,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import type { GlobalMemoryEntry } from '@gamma/shared'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { cn } from '@/lib/utils'

function formatTime(timestamp: number): string {
  if (!timestamp) return '未知时间'
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function GlobalMemorySettings(): React.ReactElement {
  const [loading, setLoading] = React.useState(true)
  const [entries, setEntries] = React.useState<GlobalMemoryEntry[]>([])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [editContent, setEditContent] = React.useState('')
  const [isDirty, setIsDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null)
  const [hasConflict, setHasConflict] = React.useState(false)

  // 新建记忆模态状态
  const [creating, setCreating] = React.useState(false)
  const [newFilePath, setNewFilePath] = React.useState('')

  const loadEntries = React.useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.listGlobalMemory()
      setEntries(list)
      if (list.length > 0) {
        if (!selectedPath || !list.some((e) => e.path === selectedPath)) {
          setSelectedPath(list[0]!.path)
          setEditContent(list[0]!.content)
          setIsDirty(false)
        } else {
          const current = list.find((e) => e.path === selectedPath)
          if (current && !isDirty) {
            setEditContent(current.content)
          }
        }
      } else {
        setSelectedPath(null)
        setEditContent('')
        setIsDirty(false)
      }
    } catch (err) {
      console.error('[长期记忆] 加载记忆列表失败:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedPath, isDirty])

  React.useEffect(() => {
    void loadEntries()
  }, [])

  const selectedEntry = React.useMemo(() => {
    return entries.find((e) => e.path === selectedPath)
  }, [entries, selectedPath])

  const handleSelectEntry = (entry: GlobalMemoryEntry): void => {
    if (isDirty && !window.confirm('当前记忆文件有未保存的修改，切换将丢失修改。是否继续？')) {
      return
    }
    setSelectedPath(entry.path)
    setEditContent(entry.content)
    setIsDirty(false)
    setHasConflict(false)
    setSaveStatus('idle')
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setEditContent(e.target.value)
    setIsDirty(e.target.value !== selectedEntry?.content)
    setSaveStatus('idle')
  }

  const handleSave = async (): Promise<void> => {
    if (!selectedPath) return
    setSaving(true)
    setHasConflict(false)
    try {
      await window.electronAPI.writeGlobalMemory(selectedPath, editContent, selectedEntry?.version)
      setSaveStatus('success')
      setIsDirty(false)
      await loadEntries()
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err: unknown) {
      console.error('[长期记忆] 保存失败:', err)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('version conflict') || msg.includes('版本冲突')) {
        setHasConflict(true)
      }
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      await window.electronAPI.deleteGlobalMemory(deleteTarget)
      setDeleteTarget(null)
      await loadEntries()
    } catch (err) {
      console.error('[长期记忆] 删除失败:', err)
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    let pathInput = newFilePath.trim()
    if (!pathInput) return
    if (!pathInput.endsWith('.md')) {
      pathInput += '.md'
    }
    pathInput = pathInput.replace(/^[/\\]+/, '')

    const template = `---\nname: ${pathInput.replace(/\.md$/, '')}\ndescription: \n---\n\n- [stated] \n`
    try {
      await window.electronAPI.writeGlobalMemory(pathInput, template, 'new')
      setCreating(false)
      setNewFilePath('')
      setSelectedPath(pathInput)
      setEditContent(template)
      setIsDirty(false)
      setHasConflict(false)
      await loadEntries()
    } catch (err) {
      console.error('[长期记忆] 创建新记忆失败:', err)
    }
  }

  const filteredEntries = React.useMemo(() => {
    if (!searchQuery.trim()) return entries
    const q = searchQuery.toLowerCase()
    return entries.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q),
    )
  }, [entries, searchQuery])

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[500px] w-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="size-5 text-primary" />
            全局长期记忆 (Pi Extension)
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            跨会话沉淀的用户身份 (profile.md)、回答偏好 (preferences.md) 与个人习惯。Agent 会在对话中自动沉淀与调用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadEntries()}
            disabled={loading}
            className="gap-1 text-xs"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            className="gap-1 text-xs"
          >
            <Plus className="size-3.5" />
            新建记忆文件
          </Button>
        </div>
      </div>

      {creating && (
        <form onSubmit={handleCreateSubmit} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">相对路径:</span>
          <Input
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            placeholder="例如: profile.md 或 topics/habits.md"
            className="h-8 flex-1 text-xs"
            autoFocus
          />
          <Button type="submit" size="sm" className="h-8 text-xs">
            确认创建
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreating(false)
              setNewFilePath('')
            }}
            className="h-8 text-xs"
          >
            取消
          </Button>
        </form>
      )}

      <div className="flex flex-1 gap-4 overflow-hidden rounded-lg border bg-card">
        {/* 左侧栏：记忆文件清单 */}
        <div className="flex w-64 flex-col border-r bg-muted/10">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索记忆..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredEntries.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {loading ? '加载中...' : '暂无记忆文件'}
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const isSelected = entry.path === selectedPath
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => handleSelectEntry(entry)}
                      className={cn(
                        'flex w-full flex-col items-start gap-1 rounded-md p-2 text-left transition-colors',
                        isSelected
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'hover:bg-muted/50 text-foreground/80',
                      )}
                    >
                      <div className="flex w-full items-center justify-between text-xs">
                        <span className="truncate font-mono">{entry.path}</span>
                        {entry.path === 'profile.md' && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 scale-90">身份</Badge>
                        )}
                        {entry.path === 'preferences.md' && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 scale-90">偏好</Badge>
                        )}
                      </div>
                      {entry.description && (
                        <p className="line-clamp-1 text-[11px] text-muted-foreground font-normal">
                          {entry.description}
                        </p>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧：记忆编辑器 / 查看器 */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedEntry ? (
            <>
              <div className="flex items-center justify-between border-b px-4 py-2.5 bg-muted/5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{selectedEntry.path}</span>
                  {isDirty && (
                    <Badge variant="secondary" className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      未保存修改
                    </Badge>
                  )}
                  {saveStatus === 'success' && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                      <CheckCircle2 className="size-3.5" /> 已保存
                    </span>
                  )}
                  {saveStatus === 'error' && (
                    <span className="flex items-center gap-1 text-[11px] text-destructive">
                      <AlertCircle className="size-3.5" /> 保存失败
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground mr-2">
                    更新于: {formatTime(selectedEntry.updatedAt)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleteTarget(selectedEntry.path)}
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5 mr-1" />
                    删除
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleSave()}
                    disabled={!isDirty || saving}
                    className="h-7 text-xs"
                  >
                    <Save className="size-3.5 mr-1" />
                    保存修改
                  </Button>
                </div>
              </div>
              {hasConflict && (
                <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="size-4 shrink-0 text-amber-500" />
                    <span>检测到版本冲突：该记忆文件在打开后已被修改。请重新加载最新内容比对后再编辑保存。</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs border-amber-500/40 hover:bg-amber-500/20"
                    onClick={async () => {
                      if (!selectedPath) return
                      setHasConflict(false)
                      await loadEntries()
                      const refreshed = await window.electronAPI.readGlobalMemory(selectedPath)
                      setEditContent(refreshed)
                      setIsDirty(false)
                    }}
                  >
                    重新载入
                  </Button>
                </div>
              )}
              <div className="flex-1 p-4">
                <Textarea
                  value={editContent}
                  onChange={handleContentChange}
                  className="h-full resize-none font-mono text-xs leading-relaxed border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0"
                  placeholder="记忆内容..."
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <Brain className="size-12 mb-3 stroke-[1.25] text-muted-foreground/40" />
              <p className="text-sm font-medium">尚未选择或建立记忆文件</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-normal">
                在与 Agent 对话时，当您说出身份（如“我叫落花流水”）、偏好或习惯时，Agent 会自主写入记忆文件；您也可以点击上方“新建记忆文件”手动沉淀。
              </p>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除此记忆文件？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <code className="font-mono">{deleteTarget}</code> 吗？删除后 Agent 将不再加载该部分记忆。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
