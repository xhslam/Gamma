import { atom } from 'jotai'
import {
  DEFAULT_CUSTOM_THEME,
  normalizeCustomTheme,
  normalizeThemeAppearance,
  normalizeThemeStyle,
  type CustomThemeColors,
  type ThemeAppearance,
  type ThemeMode,
  type ThemeStyle,
} from '../../types'
import { ASCII_THEME_REGISTRY } from '../lib/ascii-theme-registry'
import { customThemeCssVariables, resolveCustomThemeMode } from '../lib/custom-theme'

const THEME_CACHE_KEY = 'carpus-theme-mode'
const WALLPAPER_CACHE_KEY = 'carpus-chat-wallpaper'
const CUSTOM_THEME_CACHE_KEY = 'carpus-custom-theme'
const CUSTOM_THEME_DOM_PROPERTIES = Object.keys(customThemeCssVariables(DEFAULT_CUSTOM_THEME))

function readCustomThemeCache(): unknown {
  try {
    const value = localStorage.getItem(CUSTOM_THEME_CACHE_KEY)
    return value ? JSON.parse(value) : undefined
  } catch {
    return undefined
  }
}

function readAppearanceCache(): ThemeAppearance {
  try {
    return normalizeThemeAppearance({
      themeMode: localStorage.getItem(THEME_CACHE_KEY),
      themeStyle: localStorage.getItem('carpus-theme-style'),
      chatWallpaper: localStorage.getItem(WALLPAPER_CACHE_KEY),
      customTheme: readCustomThemeCache(),
    })
  } catch {
    return normalizeThemeAppearance({})
  }
}

function cacheAppearance(mode?: ThemeMode, wallpaper?: ThemeStyle, customTheme?: CustomThemeColors): void {
  try {
    if (mode) localStorage.setItem(THEME_CACHE_KEY, mode)
    if (wallpaper) localStorage.setItem(WALLPAPER_CACHE_KEY, wallpaper)
    if (customTheme) localStorage.setItem(CUSTOM_THEME_CACHE_KEY, JSON.stringify(customTheme))
  } catch {
    // 缓存不可用时仍可通过主进程保存设置。
  }
}

const initialAppearance = readAppearanceCache()
export const themeModeAtom = atom<ThemeMode>(initialAppearance.themeMode)
export const chatWallpaperAtom = atom<ThemeStyle>(initialAppearance.chatWallpaper ?? 'default')
export const customThemeAtom = atom<CustomThemeColors>(normalizeCustomTheme(initialAppearance.customTheme))
export const systemIsDarkAtom = atom(true)

function resolveTheme(
  mode: ThemeMode,
  systemIsDark: boolean,
  style: ThemeStyle,
  customTheme: CustomThemeColors,
): 'light' | 'dark' {
  if (style !== 'default') return ASCII_THEME_REGISTRY[style].mode
  if (mode === 'custom') return resolveCustomThemeMode(customTheme)
  return (mode === 'system' ? systemIsDark : mode !== 'light') ? 'dark' : 'light'
}

export const resolvedThemeAtom = atom((get) =>
  resolveTheme(get(themeModeAtom), get(systemIsDarkAtom), get(chatWallpaperAtom), get(customThemeAtom)),
)

export function applyThemeToDOM(
  mode: ThemeMode,
  systemIsDark: boolean,
  style: ThemeStyle = 'default',
  customTheme: CustomThemeColors = DEFAULT_CUSTOM_THEME,
): void {
  const html = document.documentElement
  const useCustomTheme = style === 'default' && mode === 'custom'
  html.classList.toggle('dark', resolveTheme(mode, systemIsDark, style, customTheme) === 'dark')
  if (style === 'default') delete html.dataset.sceneTheme
  else html.dataset.sceneTheme = style

  if (useCustomTheme) {
    html.dataset.customTheme = 'true'
    for (const [property, value] of Object.entries(customThemeCssVariables(customTheme))) {
      html.style.setProperty(property, value)
    }
  } else {
    delete html.dataset.customTheme
    for (const property of CUSTOM_THEME_DOM_PROPERTIES) html.style.removeProperty(property)
  }
}

export async function initializeTheme(
  setThemeMode: (mode: ThemeMode) => void,
  setSystemIsDark: (isDark: boolean) => void,
  setChatWallpaper: (style: ThemeStyle) => void,
  setCustomTheme: (colors: CustomThemeColors) => void,
): Promise<() => void> {
  function apply(settings: ThemeAppearance): void {
    const { themeMode, chatWallpaper, customTheme } = normalizeThemeAppearance(settings)
    const wallpaper = normalizeThemeStyle(chatWallpaper)
    const colors = normalizeCustomTheme(customTheme)
    setThemeMode(themeMode)
    setChatWallpaper(wallpaper)
    setCustomTheme(colors)
    cacheAppearance(themeMode, wallpaper, colors)
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
  const colors = normalizeCustomTheme(result.customTheme)
  set(themeModeAtom, result.themeMode)
  set(customThemeAtom, colors)
  cacheAppearance(result.themeMode, undefined, colors)
})

export const wallpaperSavingAtom = atom(false)
export const saveChatWallpaperAtom = atom(null, async (get, set, wallpaper: ThemeStyle) => {
  if (get(wallpaperSavingAtom) || get(chatWallpaperAtom) === wallpaper) return false
  set(wallpaperSavingAtom, true)
  try {
    const result = await window.electronAPI.updateSettings({ chatWallpaper: wallpaper })
    const saved = normalizeThemeStyle(result.chatWallpaper)
    set(chatWallpaperAtom, saved)
    set(customThemeAtom, normalizeCustomTheme(result.customTheme))
    cacheAppearance(undefined, saved)
    return true
  } finally {
    set(wallpaperSavingAtom, false)
  }
})

export const saveCustomThemeAtom = atom(null, async (_get, set, colors: CustomThemeColors) => {
  const result = await window.electronAPI.updateSettings({ customTheme: normalizeCustomTheme(colors) })
  const saved = normalizeCustomTheme(result.customTheme)
  set(customThemeAtom, saved)
  cacheAppearance(undefined, undefined, saved)
})
