/** 应用图标与品牌素材共用的十款配色，默认款为白底黑银。 */
interface AppIconDefinition {
  id: string
  name: string
  description: string
  fileName: string
}

export const APP_ICON_VARIANTS = [
  { id: 'default', name: '白底黑银', description: '默认配色 · 黑银与柔白', fileName: 'gamma-black-silver-light.png' },
  { id: 'silver-glow', name: '黑底银辉', description: '银白光芒与黑色', fileName: 'gamma-silver-glow-dark.png' },
  { id: 'emerald-gold', name: '白底翡翠金', description: '翡翠绿、金色与柔白', fileName: 'gamma-emerald-gold-light.png' },
  { id: 'sapphire-silver', name: '白底蓝银', description: '宝石蓝、银色与柔白', fileName: 'gamma-sapphire-silver-light.png' },
  { id: 'amethyst', name: '白底紫晶', description: '紫水晶与柔白', fileName: 'gamma-amethyst-light.png' },
  { id: 'coral', name: '白底珊瑚', description: '珊瑚橘与暖白', fileName: 'gamma-coral-light.png' },
  { id: 'ice-blue', name: '黑底冰蓝', description: '冰蓝、银白与深蓝', fileName: 'gamma-ice-blue-dark.png' },
  { id: 'neon-violet', name: '黑底蓝紫', description: '蓝紫光芒与深蓝', fileName: 'gamma-neon-violet-dark.png' },
  { id: 'ruby-gold', name: '黑底赤金', description: '赤红、金橘与黑色', fileName: 'gamma-ruby-gold-dark.png' },
  { id: 'emerald-glow', name: '黑底翡翠金', description: '翡翠光芒、金色与黑色', fileName: 'gamma-emerald-glow-dark.png' },
] as const satisfies readonly AppIconDefinition[]

export type AppIconVariantId = (typeof APP_ICON_VARIANTS)[number]['id']

/** IPC 只接受内置图标 ID，禁止任意路径。 */
export function isAppIconVariantId(value: unknown): value is AppIconVariantId {
  return typeof value === 'string' && APP_ICON_VARIANTS.some((variant) => variant.id === value)
}

/** 旧配色、缺失值与未知配置统一回退到白底黑银。 */
export function normalizeAppIconVariant(value: unknown): AppIconVariantId {
  return isAppIconVariantId(value) ? value : 'default'
}

/** 返回相对于 bundled resources 的路径；无效 ID 不解析。 */
export function getAppIconResourcePath(value: unknown): string | null {
  if (!isAppIconVariantId(value)) return null
  if (value === 'default') return 'icon.png'
  const variant = APP_ICON_VARIANTS.find((candidate) => candidate.id === value)
  return variant ? `gamma-logos/${variant.fileName}` : null
}
