import { describe, expect, it } from 'bun:test'
import { getCarpusUserAgent, setCarpusVersion } from './user-agent'

describe('Given Carpus 客户端身份', () => {
  it('When 普通渠道与默认请求构建 Then 使用 Carpus 名称与实际仓库地址', () => {
    setCarpusVersion('0.19.71')
    expect(getCarpusUserAgent()).toBe('Carpus/0.19.71 (+https://github.com/ErlichLiu/Proma)')
    expect(getCarpusUserAgent('1.2.3', 'anthropic')).toStartWith('Carpus/1.2.3 ')
  })
  it('When 已注册的订阅渠道构建 Then 保留原客户端标识且仍使用当前版本', () => {
    for (const provider of ['kimi-coding', 'xiaomi-token-plan', 'qwen-token-plan', 'zhipu-coding', 'zhipu-coding-team'] as const) {
      expect(getCarpusUserAgent('1.2.3', provider)).toBe('Proma/1.2.3 (+https://github.com/ErlichLiu/Proma)')
    }
  })
})
