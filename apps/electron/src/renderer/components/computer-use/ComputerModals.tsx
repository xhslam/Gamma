import * as React from 'react'
import { AlertTriangle, AppWindow, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'
import type {
  ComputerAppAuthDecision,
  ComputerAppAuthRequest,
  ComputerPermissions,
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
  const [onboardingOpen, setOnboardingOpen] = React.useState(false)
  const [permissions, setPermissions] = React.useState<ComputerPermissions | null>(null)

  React.useEffect(() => {
    const unsubApp = window.electronAPI.onComputerAppAuthRequested((req) => {
      setAppAuthReq(req)
    })
    const unsubRisk = window.electronAPI.onComputerRiskConfirmRequested((req) => {
      setRiskReq(req)
    })

    // 首次引导检查：若尚未Dismiss且有权限未被允许，弹出指引
    window.electronAPI.getComputerPreferences().then((prefs) => {
      if (prefs && !prefs.systemPermissionsDismissed) {
        window.electronAPI.getComputerState().then((state) => {
          if (state.permissions) {
            setPermissions(state.permissions)
            const allGranted =
              state.permissions.accessibility &&
              state.permissions.screen &&
              state.permissions.listen &&
              state.permissions.post
            if (!allGranted) {
              setOnboardingOpen(true)
            }
          }
        }).catch(() => {})
      }
    }).catch(() => {})

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
      {/* 1. 一次性系统权限引导 (One-time System Permissions Onboarding) */}
      <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">系统权限一次性引导</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-muted-foreground">
                  第一次使用桌面操作需为 Gamma 开启 macOS 辅助权限（仅需设置一次）
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="my-2 space-y-2">
            {[
              { id: 'accessibility' as const, name: '辅助功能 (Accessibility)', desc: '用于读取界面元素位置与输入' },
              { id: 'screen' as const, name: '屏幕录制 (Screen Recording)', desc: '用于截取操作前后的屏幕快照' },
              { id: 'listen' as const, name: '输入监听 (Input Monitoring)', desc: '感知物理键鼠操作以支持急停' },
              { id: 'post' as const, name: '事件发布 (Event Posting)', desc: '发送模拟点击与按键事件' },
            ].map((p) => {
              const granted = permissions ? permissions[p.id] : false
              return (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-2.5">
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      {granted ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <div className="h-2 w-2 rounded-full bg-amber-500" />}
                      <span>{p.name}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{p.desc}</div>
                  </div>
                  {granted ? (
                    <span className="shrink-0 text-xs font-medium text-emerald-500">已授权</span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={async () => {
                        const updated = await window.electronAPI.requestComputerPermission(p.id)
                        if (updated?.permissions) setPermissions(updated.permissions)
                      }}
                    >
                      授权
                    </Button>
                  )}
                </div>
              )
            })}
            <p className="pt-1 text-[11px] text-muted-foreground">
              提示：屏幕截图将发送给您配置的 AI 模型进行视觉解析，不包含键盘密码或支付凭据。
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={async () => {
                setOnboardingOpen(false)
                await window.electronAPI.updateComputerPreferences({ systemPermissionsDismissed: true })
              }}
            >
              完成并继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2. 按应用授权弹窗 (Per-App Authorization) */}
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
              允许后 Agent 可以通过鼠标和键盘向该应用发送操作。您随时可以在控制状态栏中停止或修改偏好。
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

      {/* 3. 高风险操作二次确认弹窗 (High-Risk Confirmation) */}
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
