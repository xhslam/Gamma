import { APP_ICON_VARIANTS } from '../../types/app-icons'
import type { AppIconVariantId } from '../../types/app-icons'
import blackSilverLight from '../assets/bots/proma-logos/proma-black-silver-light.png'
import silverGlowDark from '../assets/bots/proma-logos/proma-silver-glow-dark.png'
import emeraldGoldLight from '../assets/bots/proma-logos/proma-emerald-gold-light.png'
import sapphireSilverLight from '../assets/bots/proma-logos/proma-sapphire-silver-light.png'
import amethystLight from '../assets/bots/proma-logos/proma-amethyst-light.png'
import coralLight from '../assets/bots/proma-logos/proma-coral-light.png'
import iceBlueDark from '../assets/bots/proma-logos/proma-ice-blue-dark.png'
import neonVioletDark from '../assets/bots/proma-logos/proma-neon-violet-dark.png'
import rubyGoldDark from '../assets/bots/proma-logos/proma-ruby-gold-dark.png'
import emeraldGlowDark from '../assets/bots/proma-logos/proma-emerald-glow-dark.png'

/** 设置预览与品牌素材页共用同一组真实图标。 */
const APP_ICON_SOURCES: Record<AppIconVariantId, string> = {
  default: blackSilverLight,
  'silver-glow': silverGlowDark,
  'emerald-gold': emeraldGoldLight,
  'sapphire-silver': sapphireSilverLight,
  amethyst: amethystLight,
  coral: coralLight,
  'ice-blue': iceBlueDark,
  'neon-violet': neonVioletDark,
  'ruby-gold': rubyGoldDark,
  'emerald-glow': emeraldGlowDark,
}

export const APP_ICON_PREVIEWS = APP_ICON_VARIANTS.map((variant) => ({
  ...variant,
  src: APP_ICON_SOURCES[variant.id],
  resourcePath: `proma-logos/${variant.fileName}`,
}))
