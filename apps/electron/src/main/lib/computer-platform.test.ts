import { describe, expect, test } from 'bun:test'
import { isComputerPlatformSupported } from './computer-platform'
describe('Given Computer Use最低系统能力', () => {
  test('When 非macOS或低于14 Then 不展示可启用状态', () => {
    for (const [platform, release] of [['win32', '26.0'], ['linux', '25.0'], ['darwin', '22.9.0'], ['darwin', 'unknown']]) {
      expect(isComputerPlatformSupported(platform!, release!)).toBe(false)
    }
  })
  test('When macOS14及以后 Then 辅助功能可独立使用，仍需运行时检查', () => {
    expect(isComputerPlatformSupported('darwin', '23.0.0')).toBe(true)
    expect(isComputerPlatformSupported('darwin', '23.1.0')).toBe(true)
    expect(isComputerPlatformSupported('darwin', '23.2.0')).toBe(true)
    expect(isComputerPlatformSupported('darwin', '25.0.0')).toBe(true)
  })
})
