import { describe, expect, test } from 'bun:test'
import { isNativeCompileOnly } from './native-build-policy'
describe('Given 原生构建副作用策略', () => {
  test('When 显式compile-only或环境标记 Then 禁止开发app重签/下载', () => {
    expect(isNativeCompileOnly(['--compile-only'], {})).toBe(true)
    expect(isNativeCompileOnly([], { GAMMA_NATIVE_COMPILE_ONLY: '1' })).toBe(true)
  })
  test('When 普通开发构建 Then 保留原有显式开发准备行为', () => {
    expect(isNativeCompileOnly([], {})).toBe(false)
    expect(isNativeCompileOnly([], { GAMMA_NATIVE_COMPILE_ONLY: '0' })).toBe(false)
  })
})
