import { useEffect, useState } from 'react'
import { loadAppTheme, type AppThemeId, APP_THEME_EVENT } from './app-theme'

export function useAppTheme(): AppThemeId {
  const [theme, setTheme] = useState<AppThemeId>(() => loadAppTheme())

  useEffect(() => {
    const sync = (): void => setTheme(loadAppTheme())
    window.addEventListener(APP_THEME_EVENT, sync)
    window.addEventListener('storage', sync)
    const observer = new MutationObserver(() => sync())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      window.removeEventListener(APP_THEME_EVENT, sync)
      window.removeEventListener('storage', sync)
      observer.disconnect()
    }
  }, [])

  return theme
}
