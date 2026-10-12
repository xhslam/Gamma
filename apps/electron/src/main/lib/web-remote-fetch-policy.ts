/** 本地请求失败时，仅允许把公开网页地址交给远端正文服务。 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { assertWebUrl } from './web-network'

export interface RemoteFetchPolicyOptions {
  signal?: AbortSignal
  lookupHost?: (hostname: string) => Promise<string[]>
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.intranet', '.test', '.invalid', '.example']
const SECRET_QUERY_KEY = /^(?:auth|authorization|bearer|code|key|pwd|signature|sig|session|sessid|sid|jsessionid|jwt|ticket|xamz.+|xgoog.+)$/
const SECRET_QUERY_SUFFIX = /(?:token|secret|password|passwd|(?:sess|session)id|credentials?|(?:api|auth|access)key|signature)$/

/** 认证参数常混用 camelCase、snake_case 和连字符，不能只识别一种拼法。 */
function isSecretQueryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SECRET_QUERY_KEY.test(normalized) || SECRET_QUERY_SUFFIX.test(normalized)
}

/** TUN 的 198.18/15 fake IP 不代表域名是内网；远端服务会使用自己的公开 DNS。 */
function isPrivateDnsAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (isIP(value) === 4) {
    const [first = 0, second = 0] = value.split('.').map(Number)
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127)
  }
  if (isIP(value) === 6) {
    return value === '::' || value === '::1' || /^(?:fc|fd|fe[89ab]|ff|::ffff:)/.test(value)
  }
  return true
}

/** DNS 无法核验、内网解析或识别出认证参数时保持本地；检查不能识别任意 URL 中的秘密。 */
export async function canFetchWebRemotely(input: string, options: RemoteFetchPolicyOptions = {}): Promise<boolean> {
  options.signal?.throwIfAborted()
  let url: URL
  try { url = assertWebUrl(input) } catch { return false }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname.includes('.') || isIP(hostname) || LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false
  if ([...url.searchParams.keys()].some(isSecretQueryKey)) return false
  const lookupHost = options.lookupHost ?? (async (host: string) => (await lookup(host, { all: true })).map((entry) => entry.address))
  return new Promise<boolean>((resolve) => {
    let finished = false
    const finish = (allowed: boolean): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(allowed)
    }
    const onAbort = (): void => finish(false)
    const timeout = setTimeout(() => finish(false), 1500)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    lookupHost(hostname).then(
      (addresses) => finish(addresses.length > 0 && addresses.every((address) => !isPrivateDnsAddress(address))),
      () => finish(false),
    )
  })
}
