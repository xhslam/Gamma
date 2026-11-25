/** 与 Auris 同系列的机械芯片 图标，白底黑色为默认款。 */
interface AppIconDefinition {
  id: string
  name: string
  description: string
  fileName: string
  background: string
  foreground: string
}

export const APP_ICON_VARIANTS = [
  { id: 'default', name: '白底黑色', description: '白色底板与黑色图案', fileName: 'carpus-white-black.png', background: '#FFFFFF', foreground: '#000000' },
  { id: 'cream-orange', name: '奶油橙', description: '奶油白与赤陶橙', fileName: 'carpus-cream-orange.png', background: '#F8EEE3', foreground: '#B94816' },
  { id: 'lavender', name: '浅紫罗兰', description: '浅薰衣草与紫罗兰', fileName: 'carpus-lavender.png', background: '#EBE1FC', foreground: '#6122C8' },
  { id: 'sky-cobalt', name: '晴空钴蓝', description: '晴空蓝与钴蓝', fileName: 'carpus-sky-cobalt.png', background: '#DEECFC', foreground: '#124FCD' },
  { id: 'blush-raspberry', name: '樱花莓红', description: '樱花粉与覆盆子红', fileName: 'carpus-blush-raspberry.png', background: '#FBE4EE', foreground: '#B41D56' },
  { id: 'mint-forest', name: '薄荷森林', description: '浅薄荷与森林绿', fileName: 'carpus-mint-forest.png', background: '#E3F6E9', foreground: '#1C633B' },
  { id: 'butter-cocoa', name: '奶油可可', description: '奶油黄与可可棕', fileName: 'carpus-butter-cocoa.png', background: '#FFF2C7', foreground: '#55341C' },
  { id: 'terracotta', name: '赤陶暖白', description: '赤陶与暖白', fileName: 'carpus-terracotta.png', background: '#B9553C', foreground: '#FFF3D8' },
  { id: 'periwinkle', name: '长春花蓝', description: '长春花蓝与象牙白', fileName: 'carpus-periwinkle.png', background: '#7986E8', foreground: '#FFF6E5' },
  { id: 'midnight-cyan', name: '午夜冰青', description: '午夜蓝与冰青', fileName: 'carpus-midnight-cyan.png', background: '#12264B', foreground: '#25D9EE' },
  { id: 'aubergine-lilac', name: '暗紫丁香', description: '暗紫与丁香紫', fileName: 'carpus-aubergine-lilac.png', background: '#32133F', foreground: '#D7B4F3' },
  { id: 'charcoal-amber', name: '炭黑琥珀', description: '炭黑与琥珀金', fileName: 'carpus-charcoal-amber.png', background: '#2D2D30', foreground: '#FFB52E' },
  { id: 'forest-mint', name: '深林薄荷', description: '深森林绿与浅薄荷', fileName: 'carpus-forest-mint.png', background: '#104A38', foreground: '#D9F5E4' },
] as const satisfies readonly AppIconDefinition[]

export type AppIconVariantId = (typeof APP_ICON_VARIANTS)[number]['id']

/** 只在读取旧设置时迁移；IPC 仍只接受当前内置 ID。 */
const LEGACY_ICON_VARIANTS: Readonly<Record<string, AppIconVariantId>> = {
  'silver-glow': 'charcoal-amber',
  'emerald-gold': 'mint-forest',
  'sapphire-silver': 'sky-cobalt',
  'amethyst': 'lavender',
  'coral': 'cream-orange',
  'ice-blue': 'midnight-cyan',
  'neon-violet': 'aubergine-lilac',
  'ruby-gold': 'terracotta',
  'emerald-glow': 'forest-mint',
}

export function isAppIconVariantId(value: unknown): value is AppIconVariantId {
  return typeof value === 'string' && APP_ICON_VARIANTS.some((variant) => variant.id === value)
}

/** 旧版金属配色映射至接近的新款；缺失或未知值回退默认款。 */
export function normalizeAppIconVariant(value: unknown): AppIconVariantId {
  if (isAppIconVariantId(value)) return value
  return typeof value === 'string' && Object.hasOwn(LEGACY_ICON_VARIANTS, value)
    ? LEGACY_ICON_VARIANTS[value]! : 'default'
}

/** 返回相对于 bundled resources 的路径；无效 ID 不解析。 */
export function getAppIconResourcePath(value: unknown): string | null {
  if (!isAppIconVariantId(value)) return null
  if (value === 'default') return 'icon.png'
  const variant = APP_ICON_VARIANTS.find((candidate) => candidate.id === value)
  return variant ? `carpus-logos/${variant.fileName}` : null
}
