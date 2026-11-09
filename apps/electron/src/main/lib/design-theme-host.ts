import { buildDesignThemeCss, matchesDesignEditorThemeUrl } from './design-theme-policy'

export interface DesignThemeWebContents {
  isDestroyed(): boolean
  getURL(): string
  insertCSS(css: string, options: { cssOrigin: 'user' }): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
  on(event: 'did-finish-load' | 'did-navigate' | 'destroyed', listener: () => void): unknown
}
interface Binding { url: string; css: string; revision: number; key?: string; pending: Promise<void> }

/** CSS 仅进入编辑器主 WebContents，不修改上游缓存文件、作品文件或任何子 frame。 */
export function createDesignThemeHost() {
  const bindings = new WeakMap<DesignThemeWebContents, Binding>()
  const schedule = (contents: DesignThemeWebContents, binding: Binding): Promise<void> => {
    const revision = ++binding.revision
    binding.pending = binding.pending.catch(() => undefined).then(async () => {
      if (contents.isDestroyed() || binding.revision !== revision || !matchesDesignEditorThemeUrl(binding.url, contents.getURL())) return
      const key = await contents.insertCSS(binding.css, { cssOrigin: 'user' })
      if (contents.isDestroyed()) return
      if (binding.revision !== revision || !matchesDesignEditorThemeUrl(binding.url, contents.getURL())) {
        await contents.removeInsertedCSS(key).catch(() => undefined)
        return
      }
      const previous = binding.key
      binding.key = key
      if (previous) await contents.removeInsertedCSS(previous).catch(() => undefined)
    })
    return binding.pending
  }
  const setTheme = async (contents: DesignThemeWebContents, editorUrl: string, snapshot: unknown): Promise<void> => {
    const css = buildDesignThemeCss(snapshot)
    if (!matchesDesignEditorThemeUrl(editorUrl, contents.getURL())) throw new Error('主题仅可应用到已登记的 design 编辑器主页面')
    let binding = bindings.get(contents)
    if (!binding) {
      binding = { url: editorUrl, css, revision: 0, pending: Promise.resolve() }
      bindings.set(contents, binding)
      contents.on('did-navigate', () => {
        const current = bindings.get(contents)
        if (current) { current.key = undefined; current.revision++ }
      })
      contents.on('did-finish-load', () => {
        const current = bindings.get(contents)
        if (current) void schedule(contents, current).catch((error: unknown) => console.warn('[design] 重载主题恢复失败:', error))
      })
      contents.on('destroyed', () => { bindings.delete(contents) })
    }
    binding.url = editorUrl; binding.css = css
    await schedule(contents, binding)
  }
  return { setTheme }
}
