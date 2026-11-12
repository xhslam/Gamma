import { DESIGN_LOCALE_STORAGE_KEY, resolveDesignLocale } from './design-locale-policy'
import { matchesDesignEditorThemeUrl } from './design-theme-policy'

export interface DesignLocaleWebContents {
  isDestroyed(): boolean
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
  reload(): void
  once(event: 'did-finish-load' | 'destroyed', listener: () => void): unknown
  removeListener(event: 'did-finish-load' | 'destroyed', listener: () => void): unknown
}

/** 仅在新打开的编辑器首次展示前调用。OS 语言由 Electron 主进程提供，不信任页面自报的语言。 */
export function createDesignLocaleHost() {
  const configured = new WeakMap<DesignLocaleWebContents, Map<string, Promise<void>>>()
  function setLocale(contents: DesignLocaleWebContents, editorUrl: string, systemLanguages: readonly string[]): Promise<void> {
    if (contents.isDestroyed() || !matchesDesignEditorThemeUrl(editorUrl, contents.getURL())) return Promise.reject(new Error('语言仅可应用到已登记的 design 编辑器主页面'))
    let pages = configured.get(contents)
    if (!pages) { pages = new Map(); configured.set(contents, pages) }
    // 不因重新设置主题或 OS 偏好变动重载正在编辑的作品；下一次新开编辑器才采用新语言。
    const previous = pages.get(editorUrl)
    if (previous) return previous
    const locale = resolveDesignLocale(systemLanguages)
    const operation = (async () => {
      const needsReload = await contents.executeJavaScript(`(()=>{if(typeof globalThis.__gammaDesignLocale!=='string')throw new Error('design 资源缺少语言引导，请重新构建内置资源');const locale=${JSON.stringify(locale)};sessionStorage.setItem(${JSON.stringify(DESIGN_LOCALE_STORAGE_KEY)},locale);return globalThis.__gammaDesignLocale!==locale})()`)
      if (needsReload !== true) return
      if (contents.isDestroyed() || !matchesDesignEditorThemeUrl(editorUrl, contents.getURL())) throw new Error('design 编辑器已离开原页面，取消语言初始化')
      await new Promise<void>((resolve, reject) => {
        const clean = (): void => { clearTimeout(timer); contents.removeListener('did-finish-load', loaded); contents.removeListener('destroyed', destroyed) }
        const loaded = (): void => { clean(); resolve() }
        const destroyed = (): void => { clean(); reject(new Error('design 编辑器已关闭')) }
        const timer = setTimeout(() => { clean(); reject(new Error('design 编辑器语言初始化超时')) }, 15_000)
        contents.once('did-finish-load', loaded)
        contents.once('destroyed', destroyed)
        try { contents.reload() } catch (error) { clean(); reject(error) }
      })
      if (contents.isDestroyed() || !matchesDesignEditorThemeUrl(editorUrl, contents.getURL())) throw new Error('design 编辑器重载后地址不匹配')
      const actual = await contents.executeJavaScript('globalThis.__gammaDesignLocale')
      if (actual !== locale) throw new Error('design 编辑器语言初始化失败')
    })()
    pages.set(editorUrl, operation)
    // 已发出重载后失败也不自动重放，以免影响用户编辑；新建标签可重试。
    return operation
  }
  return { setLocale }
}
