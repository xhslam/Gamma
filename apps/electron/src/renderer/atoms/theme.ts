import { atom } from 'jotai'
import {
  normalizeThemeAppearance,
  normalizeThemeStyle,
  type ThemeAppearance,
  type ThemeMode,
  type ThemeStyle,
} from '../../types'
import { ASCII_THEME_REGISTRY } from '../lib/ascii-theme-registry'

const THEME_CACHE_KEY = 'gamma-theme-mode'
const WALLPAPER_CACHE_KEY = 'gamma-chat-wallpaper'

function readAppearanceCache(): ThemeAppearance {
  try {
    return normalizeThemeAppearance({
      themeMode: localStorage.getItem(THEME_CACHE_KEY),
      themeStyle: localStorage.getItem('gamma-theme-style'),
      chatWallpaper: localStorage.getItem(WALLPAPER_CACHE_KEY),
    })
  } catch {
    return normalizeThemeAppearance({})
  }
}

function cacheAppearance(mode?: ThemeMode, wallpaper?: ThemeStyle): void {
  try {
    if (mode) localStorage.setItem(THEME_CACHE_KEY, mode)
    if (wallpaper) localStorage.setItem(WALLPAPER_CACHE_KEY, wallpaper)
  } catch {
    // 缓存不可用时仍可通过主进程保存设置。
  }
}

const initialAppearance = readAppearanceCache()
export const themeModeAtom = atom<ThemeMode>(initialAppearance.themeMode)
export const chatWallpaperAtom = atom<ThemeStyle>(initialAppearance.chatWallpaper ?? 'default')
export const systemIsDarkAtom = atom(true)

function resolveTheme(mode: ThemeMode, systemIsDark: boolean, style: ThemeStyle): 'light' | 'dark' {
  if (style !== 'default') return ASCII_THEME_REGISTRY[style].mode
  return (mode === 'system' ? systemIsDark : mode !== 'light') ? 'dark' : 'light'
}

export const resolvedThemeAtom = atom((get) =>
  resolveTheme(get(themeModeAtom), get(systemIsDarkAtom), get(chatWallpaperAtom)),
)

export function applyThemeToDOM(mode: ThemeMode, systemIsDark: boolean, style: ThemeStyle = 'default'): void {
  const html = document.documentElement
  html.classList.toggle('dark', resolveTheme(mode, systemIsDark, style) === 'dark')
  if (style === 'default') delete html.dataset.sceneTheme
  else html.dataset.sceneTheme = style
}

export async function initializeTheme(
  setThemeMode: (mode: ThemeMode) => void,
  setSystemIsDark: (isDark: boolean) => void,
  setChatWallpaper: (style: ThemeStyle) => void,
): Promise<() => void> {
  function apply(settings: ThemeAppearance): void {
    const { themeMode, chatWallpaper } = normalizeThemeAppearance(settings)
    const wallpaper = normalizeThemeStyle(chatWallpaper)
    setThemeMode(themeMode)
    setChatWallpaper(wallpaper)
    cacheAppearance(themeMode, wallpaper)
  }

  const [settings, isDark] = await Promise.all([
    window.electronAPI.getSettings(),
    window.electronAPI.getSystemTheme(),
  ])
  apply(settings)
  setSystemIsDark(isDark)
  const cleanupSystem = window.electronAPI.onSystemThemeChanged(setSystemIsDark)
  const cleanupSettings = window.electronAPI.onThemeSettingsChanged(apply)

  return () => {
    cleanupSystem()
    cleanupSettings()
  }
}

/** 在主进程确认保存后更新本窗口，避免失败时显示未保存的主题。 */
export const saveThemeModeAtom = atom(null, async (_get, set, mode: ThemeMode) => {
  const result = await window.electronAPI.updateSettings({ themeMode: mode })
  set(themeModeAtom, result.themeMode)
  cacheAppearance(result.themeMode)
})

export const wallpaperSavingAtom = atom(false)
export const saveChatWallpaperAtom = atom(null, async (get, set, wallpaper: ThemeStyle) => {
  if (get(wallpaperSavingAtom) || get(chatWallpaperAtom) === wallpaper) return false
  set(wallpaperSavingAtom, true)
  try {
    const result = await window.electronAPI.updateSettings({ chatWallpaper: wallpaper })
    const saved = normalizeThemeStyle(result.chatWallpaper)
    set(chatWallpaperAtom, saved)
    cacheAppearance(undefined, saved)
    return true
  } finally {
    set(wallpaperSavingAtom, false)
  }
})
