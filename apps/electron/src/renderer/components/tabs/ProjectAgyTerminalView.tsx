import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { Loader2, RotateCw, Square, TerminalSquare } from 'lucide-react'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { closeProjectAgyTerminalAtom, openProjectAgyTerminalAtom, projectAgyTerminalsAtom } from '@/atoms/project-agy-terminal-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TERMINAL_BACKGROUND } from '@/lib/terminal-theme'
import { cn } from '@/lib/utils'
import { TerminalTabContent } from './TerminalTabContent'
import { AgyPermissionNotice } from './AgyPermissionNotice'
import { FadeTitle } from '@/components/ui/fade-title'

export interface ProjectAgyTerminalViewProps {
  /** 右侧工作区栏目形态：省略大标题，让终端占满可用高度。 */
  embedded?: boolean
  /** 嵌入会话面板时固定为会话所属项目，不能跟随侧栏的临时全局选择。 */
  workspaceId?: string | null
  /** 右侧面板已显示且该 Pane 获得用户焦点时才允许聚焦终端。 */
  active?: boolean
}

export function ProjectAgyTerminalView({ embedded = false, workspaceId: requestedWorkspaceId, active = true }: ProjectAgyTerminalViewProps): React.ReactElement {
  const store = useStore()
  const selectedWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaceId = requestedWorkspaceId === undefined ? selectedWorkspaceId : requestedWorkspaceId
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const terminals = useAtomValue(projectAgyTerminalsAtom)
  const open = useSetAtom(openProjectAgyTerminalAtom)
  const close = useSetAtom(closeProjectAgyTerminalAtom)
  const workspace = workspaces.find((item) => item.id === workspaceId)
  const entry = workspaceId ? terminals.get(workspaceId) : undefined
  const [confirmationOpen, setConfirmationOpen] = React.useState(false)
  const terminal = entry?.terminal
  React.useEffect(() => {
    if (!workspaceId || !active) { setConfirmationOpen(false); return }
    const current = store.get(projectAgyTerminalsAtom).get(workspaceId)
    setConfirmationOpen(!current?.accepted)
    if (current?.accepted) void open({ workspaceId })
    // 仅在项目/Pane 激活时核验或恢复已确认的实例；关闭、退出事件不触发该 effect。
    // 已退出的实例由 service 保留最终画面，必须点击重新启动，避免意外重复执行。
  }, [workspaceId, active, open, store])

  if (!workspace || !workspaceId) {
    return <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">请先在侧栏选择项目，再打开 AGY 终端。</div>
  }

  const start = (): void => { void open({ workspaceId, confirm: true }) }
  const restart = async (): Promise<void> => {
    await close(workspaceId)
    await open({ workspaceId, confirm: true })
  }
  const effectiveCwd = terminal?.cwd ?? workspace.projectRootPath ?? '托管文件目录'

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-content-area titlebar-no-drag"
      aria-label="项目级 AGY 终端"
    >
      {embedded ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/50 px-2.5">
          <TerminalSquare size={12} className="shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-[11px] font-medium">AGY</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={effectiveCwd}>{effectiveCwd}</span>
          {terminal?.exitCode !== undefined && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="重新启动 AGY" className="size-6 text-muted-foreground hover:text-foreground" onClick={() => { void restart() }}>
                  <RotateCw size={12} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">重新启动 AGY</TooltipContent>
            </Tooltip>
          )}
          {terminal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="关闭终端" className="size-6 text-muted-foreground hover:text-foreground" disabled={entry?.status === 'starting'} onClick={() => { void close(workspaceId) }}>
                  <Square size={11} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">结束该项目的 AGY 进程</TooltipContent>
            </Tooltip>
          )}
        </div>
      ) : (
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] text-foreground/80">
            <TerminalSquare size={16} strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FadeTitle className="truncate text-sm font-medium">{workspace.name}</FadeTitle>
              <span className="shrink-0 rounded border border-border/70 px-1.5 py-px text-[10px] font-medium tracking-wide text-muted-foreground">AGY</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground" title={effectiveCwd}>{effectiveCwd}</div>
          </div>
          {terminal?.exitCode !== undefined && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { void restart() }}>
              <RotateCw size={12} />重新启动
            </Button>
          )}
          {terminal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="关闭终端" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground" disabled={entry?.status === 'starting'} onClick={() => { void close(workspaceId) }}>
                  <Square size={12} />关闭
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">结束该项目的 AGY 进程</TooltipContent>
            </Tooltip>
          )}
        </header>
      )}

      <AgyPermissionNotice key={workspaceId} active={active && entry?.accepted === true} embedded={embedded} />

      <div className={cn('min-h-0 flex-1', embedded ? 'p-0' : 'p-3')}>
        <div
          className={cn('relative h-full min-h-0 overflow-hidden', !embedded && 'rounded-lg border border-border')}
          style={{ backgroundColor: TERMINAL_BACKGROUND }}
        >
          {entry?.error && (
            <div role="alert" className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive backdrop-blur">
              <span className="min-w-0 flex-1">{entry.error}</span>
              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={start}>重试</Button>
            </div>
          )}
          {terminal ? (
            <TerminalTabContent
              key={terminal.terminalId}
              terminalId={terminal.terminalId}
              sessionId={terminal.ownerId}
              cwd={terminal.cwd}
              existingOnly
              autoFocus={active}
              terminateOnUnmount={false}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              {entry?.status === 'starting' ? (
                <>
                  <Loader2 size={embedded ? 16 : 20} className="animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">正在启动项目 AGY CLI…</p>
                </>
              ) : (
                <>
                  <span className={cn('flex items-center justify-center rounded-full bg-card/[0.04] text-muted-foreground', embedded ? 'size-9' : 'size-11')}>
                    <TerminalSquare size={embedded ? 16 : 20} strokeWidth={1.5} />
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm text-foreground/85">
                      {entry?.status === 'closed' ? '该项目的 AGY 终端已关闭' : '在当前项目中直接使用 AGY CLI'}
                    </p>
                    {!embedded && <p className="text-xs text-muted-foreground">保留完整交互与模型切换，退出后可重新启动。</p>}
                  </div>
                  <Button size="sm" className="h-8" onClick={() => { if (entry?.accepted) start(); else setConfirmationOpen(true) }}>
                    {entry?.status === 'error' ? '重试启动' : entry?.status === 'closed' ? '重新启动 AGY' : '启动 AGY'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>在「{workspace.name}」中启动 AGY？</AlertDialogTitle>
            <AlertDialogDescription>
              将运行 agy --dangerously-skip-permissions，跳过全部工具权限确认。AGY 可以直接执行命令、修改和删除文件，项目目录不是文件或网络访问的沙箱。不会修改全局 AGY 配置，仅在你信任该项目及其内容时继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={start}>接受风险并启动</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
