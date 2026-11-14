import { describe, expect, test } from 'bun:test'
import { createAsciiWallpaperEngine } from './engines'
import { THEME_STYLES } from '../../../types'

describe('createAsciiWallpaperEngine', () => {
  test('Given 8 款主题 ID When 创建引擎 Then 均能成功实例化并提供标准生命周期方法', () => {
    const specialStyles = THEME_STYLES.filter((s) => s !== 'default')
    expect(specialStyles.length).toBe(8)
    for (const style of specialStyles) {
      const engine = createAsciiWallpaperEngine(style)
      expect(engine).toBeDefined()
      expect(typeof engine.init).toBe('function')
      expect(typeof engine.paint).toBe('function')
      expect(typeof engine.resize).toBe('function')
      expect(typeof engine.dispose).toBe('function')
    }
  })
})
