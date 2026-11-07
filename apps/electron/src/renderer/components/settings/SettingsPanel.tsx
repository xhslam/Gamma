import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { BookOpen, Brain, HardDrive, Info, Keyboard, Palette, Radio, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { detectIsMac } from '@/lib/platform'
import { channelFormDirtyAtom, settingsTabAtom } from '@/atoms/settings-tab'
import type { SettingsTab } from '@/atoms/settings-tab'
import { hasUpdateAtom } from '@/atoms/updater'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChannelSettings } from './ChannelSettings'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { MarkdownEditorSettingsPage } from './MarkdownEditorSettings'
import { AboutSettings } from './AboutSettings'
import { ShortcutSettings } from './ShortcutSettings'
import { StorageSettings } from './StorageSettings'
import { GlobalMemorySettings } from './GlobalMemorySettings'

interface SettingsCategory {
  label: string
  icon: LucideIcon
  page: React.ComponentType
  keywords: string
}

const categories: Record<SettingsTab, SettingsCategory> = {
  general: { label: '通用设置', icon: Settings, page: GeneralSettings, keywords: '账号 个人资料 用户名 头像 通知 声音 输入 归档 灵动岛 生产力 Git PR 日程 定时任务' },
  channels: { label: '模型配置', icon: Radio, page: ChannelSettings, keywords: '渠道 提供商 服务商 API Key 模型 Copilot OpenAI 端点' },
  memory: { label: '长期记忆', icon: Brain, page: GlobalMemorySettings, keywords: '全局记忆 文件 MEMORY' },
  appearance: { label: '外观设置', icon: Palette, page: AppearanceSettings, keywords: '主题 深色 浅色 跟随系统 颜色 字号 背景 密度 图标' },
  'markdown-editor': { label: '文档设置', icon: BookOpen, page: MarkdownEditorSettingsPage, keywords: 'Markdown 主题 字体 字号 排版 编辑器 行距 工具栏 语法' },
  shortcuts: { label: '快捷键管理', icon: Keyboard, page: ShortcutSettings, keywords: '按键 键盘 热键 发送 Cmd Enter' },
  storage: { label: '磁盘管理', icon: HardDrive, page: StorageSettings, keywords: '空间 存储 清理 临时 缓存 归档' },
  about: { label: '关于/更新', icon: Info, page: AboutSettings, keywords: '版本 更新日志 环境 诊断 运行时 终端' },
}
const categoryIds = Object.keys(categories) as SettingsTab[]

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom)
  const channelFormDirty = useAtomValue(channelFormDirtyAtom)
  const showAboutBadge = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const [query, setQuery] = React.useState('')
  const [pendingAction, setPendingAction] = React.useState<SettingsTab | 'close' | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const isMac = React.useMemo(detectIsMac, [])
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = categoryIds.filter(id => words.every(word =>
    `${categories[id].label} ${categories[id].keywords}`.toLocaleLowerCase().includes(word),
  ))
  const Page = categories[activeTab].page

  const navigate = React.useCallback((tab: SettingsTab) => {
    if (tab === activeTab) {
      setQuery('')
      return
    }
    if (activeTab === 'channels' && channelFormDirty) {
      setPendingAction(tab)
      return
    }
    setActiveTab(tab)
    setQuery('')
  }, [activeTab, channelFormDirty, setActiveTab])

  const handleClose = React.useCallback(() => {
    if (activeTab === 'channels' && channelFormDirty) {
      setPendingAction('close')
      return
    }
    onClose()
  }, [activeTab, channelFormDirty, onClose])

  React.useEffect(() => window.electronAPI.onSettingsWindowNavigate?.(navigate), [navigate])
  React.useEffect(() => window.electronAPI.onSettingsWindowCloseRequested?.(handleClose), [handleClose])
  React.useEffect(() => {
    contentRef.current?.querySelector('[data-radix-scroll-area-viewport]')?.scrollTo(0, 0)
  }, [activeTab])

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || pendingAction) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key !== 'Escape') return
      if (query && document.activeElement === searchRef.current) setQuery('')
      else handleClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleClose, pendingAction, query])

  return (
    <div className="gamma-settings-shell flex h-full min-h-0 text-foreground">
      <aside data-panel="settings-nav" className="gamma-settings-nav flex min-h-0 shrink-0 flex-col">
        <div className="gamma-settings-titlebar titlebar-drag-region" aria-hidden="true" />
        <div className="mx-3 mb-2 flex h-[26px] items-center border-b border-border/70">
          <input
            ref={searchRef}
            aria-label="搜索设置"
            placeholder="搜索设置…"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && matches[0]) navigate(matches[0]) }}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground focus-visible:placeholder:text-foreground/70"
          />
        </div>
        <nav aria-label="设置分类" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {matches.map(id => {
            const { icon: Icon, label } = categories[id]
            return (
              <button
                key={id}
                type="button"
                aria-current={activeTab === id ? 'page' : undefined}
                onClick={() => navigate(id)}
                className={cn(
                  'flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                  activeTab === id ? 'bg-foreground/[0.09] font-medium' : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                )}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>{label}</span>
                {id === 'about' && (showAboutBadge || hasEnvironmentIssues) && <span className="size-1.5 rounded-full bg-destructive" />}
              </button>
            )
          })}
          {matches.length === 0 && <p role="status" className="px-2 py-2 text-xs text-muted-foreground">没有匹配的设置</p>}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label={categories[activeTab].label}>
        <header className="gamma-settings-titlebar titlebar-drag-region flex shrink-0 items-center justify-center">
          {isMac && <h1 className="translate-y-1.5 text-[13px] font-medium">设置</h1>}
        </header>
        <ScrollArea ref={contentRef} data-panel="settings-content" className="min-h-0 min-w-0 flex-1">
          <div className="gamma-settings-page mx-auto w-full max-w-[880px] px-6 pb-6 pt-6">
            <Page key={activeTab} />
          </div>
        </ScrollArea>
      </section>

      <AlertDialog open={pendingAction !== null} onOpenChange={open => { if (!open) setPendingAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>当前渠道配置尚未保存，确定要离开吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>留在当前页</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingAction === 'close') onClose()
              else if (pendingAction) {
                setActiveTab(pendingAction)
                setQuery('')
              }
              setPendingAction(null)
            }}>放弃并离开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
