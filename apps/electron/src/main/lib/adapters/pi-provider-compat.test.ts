import { describe, expect, test } from 'bun:test'
import type { ProviderType } from '@proma/shared'
import { supportsPiDeveloperRole } from './pi-provider-compat'

describe('Pi developer 角色兼容性', () => {
  for (const provider of ['doubao-api', 'qwen', 'custom'] satisfies ProviderType[]) {
    test(`Given ${provider} 兼容端点 When 注册 Pi 模型 Then 将 developer 降级为 system`, () => {
      expect(supportsPiDeveloperRole(provider)).toBe(false)
    })
  }

  for (const provider of ['openai', 'anthropic', 'deepseek'] satisfies ProviderType[]) {
    test(`Given ${provider} 已支持端点 When 注册 Pi 模型 Then 保持 developer 支持判断`, () => {
      expect(supportsPiDeveloperRole(provider)).toBe(true)
    })
  }
})
