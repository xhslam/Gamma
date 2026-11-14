export type AppThemeId = 'white' | 'paper' | 'mint' | 'sepia' | 'night' | 'solarized'

export const APP_THEME_IDS: readonly AppThemeId[] = [
  'white',
  'paper',
  'mint',
  'sepia',
  'night',
  'solarized',
]

export const DEFAULT_APP_THEME: AppThemeId = 'night'
export const APP_THEME_STORAGE_KEY = 'auris.notes.reading-theme'
export const APP_THEME_EVENT = 'auris:app-theme'

export function isAppThemeId(value: string | null | undefined): value is AppThemeId {
  return Boolean(value && APP_THEME_IDS.includes(value as AppThemeId))
}

export function loadAppTheme(): AppThemeId {
  if (typeof window === 'undefined') return DEFAULT_APP_THEME
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    if (isAppThemeId(stored)) return stored
    const isDark = document.documentElement.classList.contains('dark') || window.matchMedia?.('(prefers-color-scheme: dark)').matches
    return isDark ? 'night' : 'paper'
  } catch {
    return DEFAULT_APP_THEME
  }
}
