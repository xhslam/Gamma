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

export function ComputerModals(): React.ReactElement {
  const [appAuthReq, setAppAuthReq] = React.useState<ComputerAppAuthRequest | null>(null)
  const [riskReq, setRiskReq] = React.useState<ComputerRiskConfirmRequest | null>(null)

  React.useEffect(() => {
    const unsubApp = window.electronAPI.onComputerAppAuthRequested((req) => {
      setAppAuthReq(req)
    })
    const unsubRisk = window.electronAPI.onComputerRiskConfirmRequested((req) => {
      setRiskReq(req)
    })

    return () => {
      unsubApp()
      unsubRisk()
    }
  }, [])

  const handleAppDecision = async (decision: ComputerAppAuthDecision) => {
    if (!appAuthReq) return
    const id = appAuthReq.requestId
    setAppAuthReq(null)
    await window.electronAPI.decideComputerAppAuth(id, decision)
  }

  const handleRiskDecision = async (confirmed: boolean) => {
    if (!riskReq) return
    const id = riskReq.requestId
    setRiskReq(null)
    await window.electronAPI.decideComputerRiskConfirm(id, confirmed)
  }

  return (
    <>
      {/* 按应用授权 */}
      <Dialog open={!!appAuthReq} onOpenChange={(open) => { if (!open) void handleAppDecision('denied') }}>
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
              允许后 Agent 可以通过鼠标和键盘向该应用发送操作。您随时可以在桌面状态控件中停止，风险策略可在通用设置中调整。
            </p>
          </div>

          <DialogFooter className="flex-row items-center justify-end gap-2 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleAppDecision('denied')}
            >
              拒绝
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
        <DialogContent className="max-w-md border-amber-500/20 dark:border-amber-500/30">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
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

          <div className="my-2 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
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
              className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500"
              onClick={() => void handleRiskDecision(true)}
            >
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
