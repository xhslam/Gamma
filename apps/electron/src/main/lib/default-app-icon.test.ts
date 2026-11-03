import { describe, expect, test } from 'bun:test'
import { loadDefaultAppIcon } from './default-app-icon'

describe('默认应用图标加载', () => {
  test('macOS 成功读取应用图标时返回图标', async () => {
    const result = await loadDefaultAppIcon('darwin', '/Applications/Test.app', {
      loadMacIcon: async () => 'data:image/png;base64,icon',
      loadNativeIcon: async () => { throw new Error('不应调用原生图标加载') },
    })
    expect(result).toBe('data:image/png;base64,icon')
  })

  test('macOS 图标缺失或路径不是应用时不调用危险的原生回退', async () => {
    let nativeCalls = 0
    const loaders = {
      loadMacIcon: async () => '',
      loadNativeIcon: async () => { nativeCalls++; return 'native' },
    }
    expect(await loadDefaultAppIcon('darwin', '/Applications/Test.app', loaders)).toBe('')
    expect(await loadDefaultAppIcon('darwin', '/tmp/test', loaders)).toBe('')
    expect(nativeCalls).toBe(0)
  })

  test('其他平台继续使用原生图标加载', async () => {
    expect(await loadDefaultAppIcon('win32', 'test.exe', {
      loadMacIcon: async () => { throw new Error('不应调用 macOS 图标加载') },
      loadNativeIcon: async () => 'native',
    })).toBe('native')
  })
})
