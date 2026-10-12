/** Gamma 品牌图标下载，与外观设置共用十款配色。 */
import * as React from 'react'
import { atom, useAtom } from 'jotai'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { APP_ICON_PREVIEWS } from '@/lib/app-icons'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { Button } from '@/components/ui/button'

interface LogoCardProps {
  logo: (typeof APP_ICON_PREVIEWS)[number]
}

function LogoCard({ logo }: LogoCardProps): React.ReactElement {
  const savingAtom = React.useMemo(() => atom(false), [])
  const [saving, setSaving] = useAtom(savingAtom)
  const operationInFlight = React.useRef(false)

  const handleDownload = React.useCallback(async () => {
    if (operationInFlight.current) return
    operationInFlight.current = true
    setSaving(true)
    try {
      const saved = await window.electronAPI.saveResourceFileAs(logo.resourcePath, logo.fileName)
      if (saved) toast.success(`${logo.name} 已保存`)
    } catch {
      toast.error('保存失败，请重试')
    } finally {
      operationInFlight.current = false
      setSaving(false)
    }
  }, [logo, setSaving])

  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <img
        src={logo.src}
        alt={logo.name}
        className="size-20 object-contain"
        draggable={false}
        loading="lazy"
        decoding="async"
      />
      <div className="w-full space-y-1 text-center">
        <div className="truncate text-xs font-medium">{logo.name}</div>
        <div className="text-xs text-muted-foreground">{logo.description}</div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`下载${logo.name}图标`}
        aria-busy={saving}
        disabled={saving}
        className="h-7 w-full gap-1.5 text-xs"
        onClick={() => { void handleDownload() }}
      >
        {saving ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
        {saving ? '正在保存…' : '下载'}
      </Button>
    </div>
  )
}

export function GammaLogoSettings(): React.ReactElement {
  return (
    <>
      <SettingsSection
        title="品牌 Logo"
        description="下载十款 Gamma 图标，用作机器人头像或品牌素材"
      >
        <div className="grid grid-cols-2 gap-4 min-[640px]:grid-cols-5">
          {APP_ICON_PREVIEWS.map((logo) => <LogoCard key={logo.id} logo={logo} />)}
        </div>
      </SettingsSection>

      <div className="my-6 border-t border-border/50" />

      <SettingsSection title="使用提示" description="在机器人平台设置头像时参考">
        <SettingsCard divided={false}>
          <div className="space-y-1.5 px-4 py-3 text-sm text-muted-foreground">
            <p>下载文件为 PNG 格式，建议使用 200 × 200 像素以上的头像。</p>
            <p>白底黑银为默认应用图标，其他九款配色可在外观设置中选择。</p>
          </div>
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
