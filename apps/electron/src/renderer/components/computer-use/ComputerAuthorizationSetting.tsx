import * as React from 'react'
import type { ComputerUsePreferences } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { SettingsRow } from '@/components/settings/primitives/SettingsRow'

/** 授权决定可以在本地撤销；读取失败时绝不覆盖既有偏好。 */
export function ComputerAuthorizationSetting(): React.ReactElement {
  const [preferences, setPreferences] = React.useState<ComputerUsePreferences | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const mounted = React.useRef(false)
  const inFlight = React.useRef(false)
  const load = React.useCallback(async () => {
    setError(null)
    try {
      const next = await window.electronAPI.getComputerPreferences()
      if (mounted.current) setPreferences(next)
    } catch { if (mounted.current) setError('无法读取桌面授权，请重试。') }
  }, [])
  React.useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [load])
  const revoke = async (app?: string): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      // 保存前重新读取完整表，避免用页面打开时的旧副本覆盖其他应用授权。
      const latest = await window.electronAPI.getComputerPreferences()
      const allowedApps = { ...latest.allowedApps }
      if (app) delete allowedApps[app]
      const next = await window.electronAPI.updateComputerPreferences(app ? { allowedApps } : { shareObservations: false })
      if (mounted.current) setPreferences(next)
    } catch { if (mounted.current) setError('授权撤销失败，已保留原设置，请重试。') }
    finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  return <SettingsRow label="桌面操作授权" description="管理已保存的应用决定；恢复询问后，下次操作该应用会重新请求授权。">
    <div className="w-full max-w-md space-y-3" aria-busy={busy}>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!preferences ? <>
        <p role="status" className="text-xs text-muted-foreground">{error ? '授权尚未读取' : '正在读取授权…'}</p>
        {error && <Button size="sm" variant="ghost" onClick={() => { void load() }}>重试读取</Button>}
      </> : <>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{preferences.shareObservations ? '已同意截图和界面文字发送给模型' : '尚未同意桌面观察外发'}</span>
          {preferences.shareObservations && <Button size="sm" variant="outline" disabled={busy} onClick={() => { void revoke() }}>撤销外发同意</Button>}
        </div>
        {Object.entries(preferences.allowedApps).length === 0 ? <p className="text-xs text-muted-foreground">没有已保存的应用决定</p> : <ul className="space-y-2">
          {Object.entries(preferences.allowedApps).map(([app, decision]) => <li key={app} className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="break-all text-xs">{app}</p><p className="text-xs text-muted-foreground">{decision === 'always' ? '总是允许' : '总是拒绝'}</p></div>
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`恢复询问 ${app}`} onClick={() => { void revoke(app) }}>恢复询问</Button>
          </li>)}
        </ul>}
      </>}
      {busy && <p role="status" className="text-xs text-muted-foreground">正在撤销授权…</p>}
    </div>
  </SettingsRow>
}
