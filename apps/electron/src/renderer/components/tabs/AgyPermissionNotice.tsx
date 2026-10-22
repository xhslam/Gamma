import * as React from 'react'
import { useAtomValue, useStore } from 'jotai'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

import { agyPermissionNoticeSeenAtom } from '@/atoms/project-agy-terminal-atoms'

export function AgyPermissionNotice({ active, embedded }: { active: boolean; embedded: boolean }): React.ReactElement | null {
  const store = useStore()
  // 订阅确保新 Store / 外部存储变化也能完成 atomWithStorage 的同步挂载。
  useAtomValue(agyPermissionNoticeSeenAtom)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (!active) { setVisible(false); return }
    // 在真正显示时消费一次性提示；分屏重挂载、切项目或重启均不再次显示。
    if (store.get(agyPermissionNoticeSeenAtom) === true) return
    store.set(agyPermissionNoticeSeenAtom, true)
    setVisible(true)
  }, [active, store])

  if (!visible) return null
  return (
    <div role="note" aria-label="AGY 权限提示" className={cn(
      'flex shrink-0 items-center gap-2 border-b border-border/50 text-muted-foreground',
      embedded ? 'px-2.5 py-1 text-[10px] leading-4' : 'px-4 py-1.5 text-[11px] leading-5',
    )}>
      <AlertTriangle size={embedded ? 10 : 12} className="shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-amber-600 dark:text-amber-400/90">已跳过权限确认</span>
        {embedded ? '：可直接执行命令、改写文件，范围不限当前目录。' : '：AGY 可执行命令、修改或删除文件，访问范围不限当前目录；切换到其他页面不会中断进程。'}
      </span>
      <button
        type="button"
        aria-label="关闭权限提示"
        title="关闭提示，以后不再显示"
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setVisible(false)}
      >
        <X size={12} />
      </button>
    </div>
  )
}
