/** 仅记录主进程验证过的编辑器地址；页面不能自行注册或解除保护。 */
export interface DesignEditorScope {
  readonly origin: string
  /** 上游 hub 挂载路径，例如 /design/<作品 token>/，始终带末尾斜线。 */
  readonly pathname: string
}
export interface DesignBrowserRequest {
  readonly url: string
  readonly method: string
}

const EDITOR_PATH = /^\/(?:slides|design|design-system|dashboard|motion)\/[A-Za-z0-9_-]+\/$/
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 不接受整站、相似域名、凭据、query 或路径前缀，避免扩大拦截范围。 */
export function parseDesignEditorScope(value: string): DesignEditorScope {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || Number(url.port) < 1 || Number(url.port) > 65535 || url.username || url.password
    || url.search || url.hash || !EDITOR_PATH.test(url.pathname)) {
    throw new Error('design 浏览器保护只接受已验证的 loopback 作品编辑器地址')
  }
  return { origin: url.origin, pathname: url.pathname }
}

/**
 * 固定 revision 的五种编辑器都通过 POST /__share 的 action:lan 打开 LAN；
 * hub 会剥掉 /<kind>/<token>/ 前缀，也会按 Referer 转交根路径 /__share。
 * POST /__hub 的 mount 可携带 lan:true，因此一并封锁该 origin 的全局控制入口。
 * 不读取正文，也没有页面可用的“已经同意”开关。未来共享授权须由 Gamma 独立实现。
 * /__share/archive 与 /__share/save 是本地导出，不是授权变化，必须继续可用。
 */
export function shouldBlockDesignBrowserRequest(request: DesignBrowserRequest, scopes: Iterable<DesignEditorScope>): boolean {
  if (READ_METHODS.has(request.method.toUpperCase())) return false
  let url: URL
  try { url = new URL(request.url) } catch { return false }
  for (const scope of scopes) {
    if (url.origin !== scope.origin) continue
    if (url.pathname === '/__hub' || url.pathname === '/__share'
      || url.pathname === `${scope.pathname}__share`) return true
  }
  return false
}

/** 独立 registry 用于 BDD；每次注册返回幂等 disposer，重复打开互不解除保护。 */
export function createDesignBrowserPolicy() {
  const scopes = new Map<symbol, DesignEditorScope>()
  function registerDesignEditorOrigin(url: string): () => void {
    const scope = parseDesignEditorScope(url)
    const token = Symbol('design-editor-scope')
    scopes.set(token, scope)
    return () => { scopes.delete(token) }
  }
  function isBlockedDesignEditorRequest(request: DesignBrowserRequest): boolean {
    return shouldBlockDesignBrowserRequest(request, scopes.values())
  }
  return { registerDesignEditorOrigin, isBlockedDesignEditorRequest }
}

const policy = createDesignBrowserPolicy()
export const registerDesignEditorOrigin = policy.registerDesignEditorOrigin
export const isBlockedDesignEditorRequest = policy.isBlockedDesignEditorRequest
