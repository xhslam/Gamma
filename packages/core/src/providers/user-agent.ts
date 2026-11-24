import type { ProviderType } from '@carpus/shared'

const CARPUS_REPO_URL = 'https://github.com/ErlichLiu/Proma'

// 这些订阅渠道沿用本软件已注册的历史客户端标识，待供应商支持 Carpus 后再升级。
const LEGACY_REGISTERED_PROVIDERS: readonly ProviderType[] = [
  'kimi-coding', 'xiaomi-token-plan', 'qwen-token-plan', 'zhipu-coding', 'zhipu-coding-team',
]

let _carpusVersion = '0.0.0'

export function setCarpusVersion(version: string): void {
  _carpusVersion = version
}

export function getCarpusVersion(): string {
  return _carpusVersion
}

export function getCarpusUserAgent(version?: string, provider?: ProviderType): string {
  const v = version ?? _carpusVersion
  const name = provider && LEGACY_REGISTERED_PROVIDERS.includes(provider) ? 'Proma' : 'Carpus'
  return `${name}/${v} (+${CARPUS_REPO_URL})`
}
