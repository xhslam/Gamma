import { describe, expect, test } from 'bun:test'
import { isComputerPlatformSupported } from './computer-platform'

describe('Given Computer Use最低系统能力', () => {
  test('When 不受支持的平台或旧版系统 Then 不展示可启用状态', () => {
    for (const [platform, release] of [
      ['win32', '6.3.9600'],
      ['win32', '6.1.7601'],
      ['win32', 'unknown'],
      ['linux', '25.0'],
      ['darwin', '22.9.0'],
      ['darwin', 'unknown'],
    ]) {
      expect(isComputerPlatformSupported(platform!, release!)).toBe(false)
    }
  })

  test('When macOS14及以后 Then 辅助功能可独立使用，仍需运行时检查', () => {
    expect(isComputerPlatformSupported('darwin', '23.0.0')).toBe(true)
    expect(isComputerPlatformSupported('darwin', '23.1.0')).toBe(true)
    expect(isComputerPlatformSupported('darwin', '23.2.0')).toBe(true)
    expect(isComputerPlatformSupported('darwin', '25.0.0')).toBe(true)
  })

  test('When Windows 10及以后 Then 桌面自动化原生支持', () => {
    expect(isComputerPlatformSupported('win32', '10.0.19041')).toBe(true)
    expect(isComputerPlatformSupported('win32', '10.0.19045')).toBe(true)
    expect(isComputerPlatformSupported('win32', '10.0.22000')).toBe(true)
    expect(isComputerPlatformSupported('win32', '10.0.22631')).toBe(true)
    expect(isComputerPlatformSupported('win32', '10.0.26100')).toBe(true)
  })
})

