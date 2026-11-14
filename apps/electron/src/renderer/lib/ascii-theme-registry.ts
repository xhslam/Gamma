import type { ThemeStyle } from '../../types'

export interface AsciiThemeDefinition {
  id: ThemeStyle
  name: string
  englishName: string
  mode: 'light' | 'dark'
  backgroundColor: string
  foregroundColor: string
  accentColor: string
  glyphs: string
}

export const ASCII_THEME_REGISTRY: Record<Exclude<ThemeStyle, 'default'>, AsciiThemeDefinition> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    englishName: 'Claude Code',
    mode: 'dark',
    backgroundColor: '#1F1E1D',
    foregroundColor: '#F0EEE6',
    accentColor: '#D97757',
    glyphs: '+-/*~|',
  },
  'cloud-drift': {
    id: 'cloud-drift',
    name: '云朵舞者',
    englishName: 'Cloud Drift',
    mode: 'light',
    backgroundColor: '#BAEEF5',
    foregroundColor: '#141413',
    accentColor: '#0284c7',
    glyphs: '%;:st+|',
  },
  'honu-lagoon': {
    id: 'honu-lagoon',
    name: '碧海绿龟',
    englishName: 'Honu Lagoon',
    mode: 'dark',
    backgroundColor: '#1C4E4B',
    foregroundColor: '#ECFDF5',
    accentColor: '#14b8a6',
    glyphs: '~sSO0*',
  },
  'koi-pond': {
    id: 'koi-pond',
    name: '锦鲤碧潭',
    englishName: 'Koi Pond',
    mode: 'dark',
    backgroundColor: '#254B3E',
    foregroundColor: '#F0FDF4',
    accentColor: '#10b981',
    glyphs: '()~sSo*',
  },
  'jellyfish': {
    id: 'jellyfish',
    name: '深海水母',
    englishName: 'Jellyfish',
    mode: 'dark',
    backgroundColor: '#0B2030',
    foregroundColor: '#F0F9FF',
    accentColor: '#38bdf8',
    glyphs: '()^|*:.',
  },
  'paper-boats': {
    id: 'paper-boats',
    name: '青波纸船',
    englishName: 'Paper Boats',
    mode: 'dark',
    backgroundColor: '#284A4B',
    foregroundColor: '#F0FDFA',
    accentColor: '#2dd4bf',
    glyphs: '/\\_^~=',
  },
  'fireflies': {
    id: 'fireflies',
    name: '夏夜萤火',
    englishName: 'Fireflies',
    mode: 'dark',
    backgroundColor: '#091216',
    foregroundColor: '#F7FEE7',
    accentColor: '#a3e635',
    glyphs: '*+·oO',
  },
  'moonlit': {
    id: 'moonlit',
    name: '皓月繁星',
    englishName: 'Moonlit',
    mode: 'dark',
    backgroundColor: '#090C1C',
    foregroundColor: '#EEF2FF',
    accentColor: '#818cf8',
    glyphs: '*+~().',
  },
}

export function getAsciiThemeDefinition(style: ThemeStyle): AsciiThemeDefinition {
  if (style === 'default' || !(style in ASCII_THEME_REGISTRY)) {
    return ASCII_THEME_REGISTRY['claude-code']
  }
  return ASCII_THEME_REGISTRY[style as keyof typeof ASCII_THEME_REGISTRY]
}
