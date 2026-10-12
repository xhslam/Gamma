import type { ProviderType } from '@gamma/shared'

const GAMMA_REPO_URL = 'https://github.com/ErlichLiu/Proma'

// 这些订阅渠道沿用本软件已注册的历史客户端标识，待供应商支持 Gamma 后再升级。
const LEGACY_REGISTERED_PROVIDERS: readonly ProviderType[] = [
  'kimi-coding', 'xiaomi-token-plan', 'qwen-token-plan', 'zhipu-coding', 'zhipu-coding-team',
]

let _gammaVersion = '0.0.0'

export function setGammaVersion(version: string): void {
  _gammaVersion = version
}

export function getGammaVersion(): string {
  return _gammaVersion
}

export function getGammaUserAgent(version?: string, provider?: ProviderType): string {
  const v = version ?? _gammaVersion
  const name = provider && LEGACY_REGISTERED_PROVIDERS.includes(provider) ? 'Proma' : 'Gamma'
  return `${name}/${v} (+${GAMMA_REPO_URL})`
}
