import { APP_ICON_VARIANTS } from '../../types/app-icons'
import type { AppIconVariantId } from '../../types/app-icons'

import icon0 from '../assets/bots/carpus-logos/carpus-white-black.png'
import icon1 from '../assets/bots/carpus-logos/carpus-cream-orange.png'
import icon2 from '../assets/bots/carpus-logos/carpus-lavender.png'
import icon3 from '../assets/bots/carpus-logos/carpus-sky-cobalt.png'
import icon4 from '../assets/bots/carpus-logos/carpus-blush-raspberry.png'
import icon5 from '../assets/bots/carpus-logos/carpus-mint-forest.png'
import icon6 from '../assets/bots/carpus-logos/carpus-butter-cocoa.png'
import icon7 from '../assets/bots/carpus-logos/carpus-terracotta.png'
import icon8 from '../assets/bots/carpus-logos/carpus-periwinkle.png'
import icon9 from '../assets/bots/carpus-logos/carpus-midnight-cyan.png'
import icon10 from '../assets/bots/carpus-logos/carpus-aubergine-lilac.png'
import icon11 from '../assets/bots/carpus-logos/carpus-charcoal-amber.png'
import icon12 from '../assets/bots/carpus-logos/carpus-forest-mint.png'

/** Vite 显式导入资源，设置预览与品牌下载共用同一套配色。 */
const APP_ICON_SOURCES: Record<AppIconVariantId, string> = {
  'default': icon0,
  'cream-orange': icon1,
  'lavender': icon2,
  'sky-cobalt': icon3,
  'blush-raspberry': icon4,
  'mint-forest': icon5,
  'butter-cocoa': icon6,
  'terracotta': icon7,
  'periwinkle': icon8,
  'midnight-cyan': icon9,
  'aubergine-lilac': icon10,
  'charcoal-amber': icon11,
  'forest-mint': icon12,
}

export const APP_ICON_PREVIEWS = APP_ICON_VARIANTS.map((variant) => ({
  ...variant,
  src: APP_ICON_SOURCES[variant.id],
  resourcePath: `carpus-logos/${variant.fileName}`,
}))
