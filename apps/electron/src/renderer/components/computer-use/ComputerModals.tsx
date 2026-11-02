import * as React from 'react'
import { AlertTriangle, AppWindow, ShieldAlert } from 'lucide-react'
import type {
  ComputerAppAuthDecision,
  ComputerAppAuthRequest,
  ComputerRiskConfirmRequest,
} from '@gamma/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ComputerUseStatus } from './ComputerUseStatus'

export function ComputerModals(): React.ReactElement {
  const [appAuthReq, setAppAuthReq] = React.useState<ComputerAppAuthRequest | null>(null)
  const [appError, setAppError] = React.useState<string | null>(null)
  const [riskError, setRiskError] = React.useState<string | null>(null)
  const appInFlight = React.useRef(false)
  const riskInFlight = React.useRef(false)
  const [riskReq, setRiskReq] = React.useState<ComputerRiskConfirmRequest | null>(null)

  React.useEffect(() => {
    const unsubApp = window.electronAPI.onComputerAppAuthRequested((req) => {
      setAppError(null); setAppAuthReq(req)
    })
    const unsubRisk = window.electronAPI.onComputerRiskConfirmRequested((req) => {
      setRiskError(null); setRiskReq(req)
    })

    return () => {
      unsubApp()
      unsubRisk()
    }
  }, [])

  const handleAppDecision = async (decision: ComputerAppAuthDecision): Promise<void> => {
    if (!appAuthReq || appInFlight.current) return
    appInFlight.current = true
    const request = appAuthReq
    setAppAuthReq(null); setAppError(null)
    try {
      const accepted = await window.electronAPI.decideComputerAppAuth(request.requestId, decision)
      if (!accepted) setAppError('应用授权请求已失效，此选择未应用。请检查当前设置。')
    } catch {
      // IPC 异常不能证明主进程未收到，不能重开旧请求或宣称未保存。
      setAppError('应用授权决定的投递结果未知。请检查本地授权状态，不要重复提交旧请求。')
    } finally { appInFlight.current = false }
  }

  const handleRiskDecision = async (confirmed: boolean): Promise<void> => {
    if (!riskReq || riskInFlight.current) return
    riskInFlight.current = true
    const id = riskReq.requestId
    setRiskReq(null); setRiskError(null)
    try {
      const accepted = await window.electronAPI.decideComputerRiskConfirm(id, confirmed)
      if (!accepted) setRiskError('风险确认请求已失效，此选择未应用。请检查当前任务状态。')
    } catch {
      setRiskError('风险确认的投递结果未知。请检查任务执行结果，不要重复提交或重放动作。')
    } finally { riskInFlight.current = false }
  }

  return (
    <>
      {(appError || riskError) && <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border bg-background p-3 text-sm text-destructive">
        {appError && <p>{appError}</p>}
        {riskError && <p>{riskError}</p>}
      </div>}
      {/* 按应用授权 */}
      <Dialog open={!!appAuthReq} onOpenChange={(open) => { if (!open) void handleAppDecision('cancelled') }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <AppWindow className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">应用控制授权</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-muted-foreground">
                  Agent 请求操作此应用以完成任务
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="my-2 rounded-xl border border-border/50 bg-muted/30 p-3.5">
            <div className="text-sm font-medium text-foreground">
              {appAuthReq?.appName}
            </div>
            {appAuthReq?.bundleId && (
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {appAuthReq.bundleId}
              </div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              本次允许仅在当前运行有效；总是允许或总是拒绝会保存，可在通用设置恢复默认。应用授权不替代界面观察外发同意或高风险动作确认。基础操作使用 Gamma 辅助功能授权；截图需要可选录屏权限，物理键鼠输入需另行允许。
            </p>
          </div>

          <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 sm:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleAppDecision('cancelled')}>取消</Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleAppDecision('denied')}
            >
              总是拒绝
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleAppDecision('once')}
            >
              本次允许
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void handleAppDecision('always')}
            >
              总是允许
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 高风险操作确认 */}
      <Dialog open={!!riskReq} onOpenChange={(open) => { if (!open) void handleRiskDecision(false) }}>
        <DialogContent className="max-w-md border-warning/20 dark:border-warning/30">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning dark:text-warning">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">
                  {riskReq?.title ?? '高风险操作确认'}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-muted-foreground">
                  执行具有破坏性、资金交易或向外发送的操作前需人工确认
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="my-2 space-y-2 rounded-xl border border-warning/20 bg-warning/5 p-3.5 text-xs text-warning dark:text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning dark:text-warning" />
              <div className="space-y-1">
                <div className="font-medium text-foreground">
                  {riskReq?.reason}
                </div>
                {riskReq?.targetApp && (
                  <div className="text-muted-foreground">
                    目标应用: <span className="font-medium text-foreground">{riskReq.targetApp}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row items-center justify-end gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRiskDecision(false)}
            >
              取消并中止
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="bg-warning text-primary-foreground hover:bg-warning dark:bg-warning dark:hover:bg-warning"
              onClick={() => void handleRiskDecision(true)}
            >
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 桌面运行状态条 */}
      <ComputerUseStatus />
    </>
  )
}
