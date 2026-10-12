import { describe, expect, it } from 'bun:test'
import { getGammaUserAgent, setGammaVersion } from './user-agent'

describe('Given Gamma 客户端身份', () => {
  it('When 普通渠道与默认请求构建 Then 使用 Gamma 名称与实际仓库地址', () => {
    setGammaVersion('0.19.71')
    expect(getGammaUserAgent()).toBe('Gamma/0.19.71 (+https://github.com/ErlichLiu/Proma)')
    expect(getGammaUserAgent('1.2.3', 'anthropic')).toStartWith('Gamma/1.2.3 ')
  })
  it('When 已注册的订阅渠道构建 Then 保留原客户端标识且仍使用当前版本', () => {
    for (const provider of ['kimi-coding', 'xiaomi-token-plan', 'qwen-token-plan', 'zhipu-coding', 'zhipu-coding-team'] as const) {
      expect(getGammaUserAgent('1.2.3', provider)).toBe('Proma/1.2.3 (+https://github.com/ErlichLiu/Proma)')
    }
  })
})
