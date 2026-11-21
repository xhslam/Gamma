import type { Channel, ChannelPlanQuotaResult, ChannelPlanQuotaWindow, ProviderType } from '@gamma/shared'

export interface LoadedPlanQuota {
  channelKey: string
  result: ChannelPlanQuotaResult
}

export function planQuotaAccountKey(channelId?: string | null, updatedAt?: number): string | null {
  return channelId ? JSON.stringify([channelId, updatedAt]) : null
}

export function currentPlanQuota(loaded: LoadedPlanQuota | null, channelKey: string | null): ChannelPlanQuotaResult | null {
  return channelKey !== null && loaded?.channelKey === channelKey ? loaded.result : null
}

interface PlanQuotaDisplay {
  summary: string
  title: string
  muted: boolean
}

/** 显示状态必须与凭据版本绑定，不能在 effect 执行前闪现旧账号结果。 */
export function planQuotaChannelKey(channel: Pick<Channel, 'id' | 'updatedAt' | 'provider' | 'baseUrl'>): string {
  return JSON.stringify([channel.id, channel.updatedAt, channel.provider, channel.baseUrl])
}

function formatWindow(window: ChannelPlanQuotaWindow): string {
  const label = window.type === '5h' ? '5H' : window.type === 'weekly' ? '周' : window.label.replace(/\s+/g, '')
  return `${label} ${window.remainingLabel ?? `${window.remainingPercent}%`}`
}

export function formatPlanQuotaWindowValue(window: ChannelPlanQuotaWindow, provider: ProviderType): string {
  const date = window.resetAt === undefined ? undefined : new Date(window.resetAt)
  const reset = date && Number.isFinite(date.getTime())
    ? `，重置 ${new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(date)}`
    : provider === 'github-copilot' ? '，未提供重置时间' : ''
  const value = window.remainingLabel ?? `${window.remainingPercent}%`
  return `${window.showProgress === false ? value : `剩余 ${value}`}${reset}`
}

/**
 * 重置倒计时：不足 1 小时显示分钟，不足 24 小时显示小时，否则显示天。
 * 已到期或缺少重置时间时返回 null，由调用方省略该段。
 */
export function formatPlanQuotaResetCountdown(resetAt: number | undefined, now: number): string | null {
  if (resetAt === undefined) return null
  const diff = resetAt - now
  if (!Number.isFinite(diff) || diff <= 0) return null
  const minutes = Math.ceil(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(diff / 3_600_000)
  if (hours < 24) return `${Math.max(1, hours)}h`
  return `${Math.max(1, Math.round(diff / 86_400_000))}天`
}

export interface PlanQuotaPillDisplay extends PlanQuotaDisplay {
  /** 任一展示窗口剩余 ≤20% 时为 true，胶囊用警告色提醒。 */
  lowQuota: boolean
}

/**
 * 输入框工具栏额度胶囊的摘要：优先 5H / 周 两个窗口，附带重置倒计时。
 * 与 getPlanQuotaDisplay 的下拉徽章摘要分开维护，避免互相影响。
 */
export function getPlanQuotaPillDisplay(
  quota: ChannelPlanQuotaResult | null,
  provider: ProviderType,
  now: number,
): PlanQuotaPillDisplay | null {
  const copilot = provider === 'github-copilot'
  if (!quota) {
    return copilot
      ? { summary: '额度加载中', title: '正在读取 GitHub Copilot 订阅额度', muted: true, lowQuota: false }
      : null
  }
  if (!quota.supported || quota.windows.length === 0) {
    return copilot
      ? {
        summary: quota.supported ? '额度未知' : '额度不可用',
        title: quota.message ?? 'GitHub Copilot 未提供可用额度数据',
        muted: true,
        lowQuota: false,
      }
      : null
  }

  const primary = [quota.windows.find((window) => window.type === '5h'), quota.windows.find((window) => window.type === 'weekly')]
    .filter((window): window is ChannelPlanQuotaWindow => Boolean(window))
  const shown = primary.length > 0 ? primary : quota.windows.slice(0, 2)
  const summary = shown.map((window) => {
    const label = window.type === '5h' ? '5H' : window.type === 'weekly' ? '周' : window.label.replace(/\s+/g, '')
    const value = window.remainingLabel ?? `${window.remainingPercent}%`
    const countdown = formatPlanQuotaResetCountdown(window.resetAt, now)
    return countdown ? `${label} ${value} · ${countdown}` : `${label} ${value}`
  }).join(' ｜ ')
  const details = quota.windows.map((window) => `${window.label}: ${formatPlanQuotaWindowValue(window, provider)}`).join('\n')
  const lowQuota = shown.some((window) => window.showProgress !== false && window.remainingPercent <= 20)
  return { summary, title: `${quota.planName ?? '订阅额度'}\n${details}`, muted: false, lowQuota }
}

export function getPlanQuotaDisplay(quota: ChannelPlanQuotaResult | null, provider: ProviderType): PlanQuotaDisplay | null {
  const copilot = provider === 'github-copilot'
  if (!quota) return copilot ? { summary: '额度加载中', title: '正在读取 GitHub Copilot 订阅额度', muted: true } : null
  if (!quota.supported || quota.windows.length === 0) {
    return copilot ? {
      summary: quota.supported ? '额度未知' : '额度不可用',
      title: quota.message ?? 'GitHub Copilot 未提供可用额度数据',
      muted: true,
    } : null
  }

  const primary = [quota.windows.find((window) => window.type === '5h'), quota.windows.find((window) => window.type === 'weekly')]
    .filter((window): window is ChannelPlanQuotaWindow => Boolean(window))
  const summary = (primary.length > 0 ? primary : quota.windows.slice(0, 2)).map(formatWindow).join(' · ')
  const details = quota.windows.map((window) => `${window.label}: ${formatPlanQuotaWindowValue(window, provider)}`).join('\n')
  return { summary, title: `${quota.planName ?? '订阅额度'}\n${details}`, muted: false }
}
