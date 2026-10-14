import * as React from 'react'
import { useAtom } from 'jotai'
import { AppShell } from './components/app-shell/AppShell'
import { EnvironmentCheckDialog } from './components/environment/EnvironmentCheckDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { ShortcutGuideDialog } from './components/shortcuts/ShortcutGuideDialog'
import { PlanningReminderRail } from './components/planning/PlanningReminderRail'
import { environmentCheckDialogOpenAtom } from './atoms/environment'

export default function App(): React.ReactElement {
  // 保留设置初始化；主工作区直接显示，各功能自行呈现加载状态。
  React.useEffect(() => {
    const initialize = async () => {
      try {
        await window.electronAPI.getSettings()
      } catch (error) {
        console.error('[App] 初始化失败:', error)
      }
    }

    initialize()
  }, [])

  // 显示主界面
  return (
    <TooltipProvider delayDuration={200} disableHoverableContent>
      <AppShell />
      <PlanningReminderRail />
      <ShortcutGuideDialog />
      <GlobalEnvironmentCheckDialog />
    </TooltipProvider>
  )
}

/**
 * 全局环境检测 Dialog，由错误卡片的 recovery action 按钮打开。
 */
function GlobalEnvironmentCheckDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(environmentCheckDialogOpenAtom)
  return <EnvironmentCheckDialog open={open} onOpenChange={setOpen} />
}
