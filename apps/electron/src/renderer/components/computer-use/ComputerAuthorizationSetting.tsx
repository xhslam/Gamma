import * as React from 'react'
import type { ComputerPermission, ComputerPermissions, ComputerUsePreferences } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { SettingsRow } from '@/components/settings/primitives/SettingsRow'

/** 授权决定可以在本地撤销；读取失败时绝不覆盖既有偏好。 */
export function ComputerAuthorizationSetting(): React.ReactElement {
  const [preferences, setPreferences] = React.useState<ComputerUsePreferences | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [permissions, setPermissions] = React.useState<ComputerPermissions | undefined>()
  const [permissionBusy, setPermissionBusy] = React.useState<ComputerPermission | null>(null)
  const [permissionMessage, setPermissionMessage] = React.useState<string | null>(null)
  const mounted = React.useRef(false)
  const inFlight = React.useRef(false)
  const permissionInFlight = React.useRef(false)
  const load = React.useCallback(async () => {
    setError(null)
    try {
      const next = await window.electronAPI.getComputerPreferences()
      if (mounted.current) setPreferences(next)
    } catch { if (mounted.current) setError('无法读取桌面授权，请重试。') }
  }, [])
  React.useEffect(() => {
    mounted.current = true
    void load()
    void window.electronAPI.getComputerState().then(state => { if (mounted.current) setPermissions(state.permissions) }).catch(() => {})
    return () => { mounted.current = false }
  }, [load])
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
  const requestPermission = async (permission: 'accessibility' | 'screen'): Promise<void> => {
    if (permissionInFlight.current) return
    permissionInFlight.current = true; setPermissionBusy(permission); setPermissionMessage(null)
    try {
      await window.electronAPI.requestComputerPermission(permission)
      const state = await window.electronAPI.getComputerState()
      if (!mounted.current) return
      setPermissions(state.permissions)
      setPermissionMessage(permission === 'accessibility'
        ? state.permissions?.accessibility ? 'Gamma 辅助功能已授权。' : '请在 macOS 辅助功能中开启 Gamma，然后返回继续。'
        : state.permissions?.screen ? '画面预览已可用。' : '录屏尚未开启，辅助功能操作仍可继续。')
    } catch {
      if (mounted.current) setPermissionMessage('未能完成系统授权，请重试。基础操作只需要 Gamma 的辅助功能授权。')
    } finally {
      permissionInFlight.current = false
      if (mounted.current) setPermissionBusy(null)
    }
  }
  return <SettingsRow label="桌面操作授权" description="基础操作只需授权 Gamma 辅助功能；截图与实时画面使用可选的录屏权限。无需单独寻找其他应用。">
    <div className="w-full max-w-md space-y-3" aria-busy={busy}>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!preferences ? <>
        <p role="status" className="text-xs text-muted-foreground">{error ? '授权尚未读取' : '正在读取授权…'}</p>
        {error && <Button size="sm" variant="ghost" onClick={() => { void load() }}>重试读取</Button>}
      </> : <>
        <div className="space-y-2 border-b border-border/50 pb-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || permissionBusy !== null || permissions?.accessibility === true} onClick={() => { void requestPermission('accessibility') }}>{permissionBusy === 'accessibility' ? '正在请求辅助功能…' : permissions?.accessibility ? '辅助功能已授权' : '授权 Gamma 辅助功能'}</Button>
            <Button size="sm" variant="ghost" disabled={busy || permissionBusy !== null || permissions?.screen === true} onClick={() => { void requestPermission('screen') }}>{permissionBusy === 'screen' ? '正在请求录屏…' : permissions?.screen ? '画面预览已启用' : '开启可选画面预览'}</Button>
          </div>
          {permissionMessage && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{permissionMessage}</p>}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{preferences.shareObservations ? '已同意按需发送界面文字和可用截图给模型' : '尚未同意桌面观察外发'}</span>
          {preferences.shareObservations && <Button size="sm" variant="outline" disabled={busy} onClick={() => { void revoke() }}>撤销外发同意</Button>}
        </div>
        <p className="text-xs text-muted-foreground">{preferences.riskPolicy === 'relaxed' ? '宽松策略下，应用默认可用于当前任务；已保存的拒绝仍会阻止操作。' : '当前策略下，未保存授权决定的应用会请求确认；已保存的拒绝仍会阻止操作。'}可在下方恢复已保存的决定。</p>
        {Object.entries(preferences.allowedApps).length === 0 ? <p className="text-xs text-muted-foreground">没有已保存的应用决定</p> : <ul className="space-y-2">
          {Object.entries(preferences.allowedApps).map(([app, decision]) => <li key={app} className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="break-all text-xs">{app}</p><p className="text-xs text-muted-foreground">{decision === 'always' ? '总是允许' : '总是拒绝'}</p></div>
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`恢复默认 ${app}`} onClick={() => { void revoke(app) }}>恢复默认</Button>
          </li>)}
        </ul>}
      </>}
      {busy && <p role="status" className="text-xs text-muted-foreground">正在撤销授权…</p>}
    </div>
  </SettingsRow>
}
