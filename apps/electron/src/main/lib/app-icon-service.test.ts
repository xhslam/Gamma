import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { APP_ICON_VARIANTS } from '../../types/app-icons'
import { resolveAppIconPath, restoreAppIconVariant, setAppIconVariant } from './app-icon-service'
import type { AppIconDependencies } from './app-icon-service'
import type { AppIconVariantId } from '../../types/app-icons'

const resourcesDir = join(import.meta.dir, 'test-resources')
const defaultPath = join(resourcesDir, 'icon.png')
const emeraldPath = join(resourcesDir, 'gamma-logos', 'gamma-emerald-gold-light.png')

function createRuntime(savedVariant: unknown = 'default') {
  let persistedVariant = savedVariant
  let dockIconPath = defaultPath
  const appliedPaths: string[] = []
  const savedVariants: AppIconVariantId[] = []
  const availablePaths = new Set([defaultPath, ...APP_ICON_VARIANTS.map((variant) =>
    join(resourcesDir, 'gamma-logos', variant.fileName),
  )])
  const dependencies: AppIconDependencies = {
    platform: 'darwin',
    resourcesDir,
    fileExists: (path) => availablePaths.has(path),
    setDockIcon: (path) => { dockIconPath = path; appliedPaths.push(path) },
    readVariant: () => persistedVariant,
    saveVariant: (variantId) => { persistedVariant = variantId; savedVariants.push(variantId) },
  }
  return {
    dependencies,
    availablePaths,
    appliedPaths,
    savedVariants,
    getPersistedVariant: () => persistedVariant,
    getDockIconPath: () => dockIconPath,
  }
}

describe('应用图标切换与重启恢复', () => {
  test('Given 十款内置图标 When 解析资源路径 Then 默认指向 icon.png 且其余均指向对应品牌资源', () => {
    expect(resolveAppIconPath('default', resourcesDir)).toBe(defaultPath)
    for (const variant of APP_ICON_VARIANTS.slice(1)) {
      expect(resolveAppIconPath(variant.id, resourcesDir)).toBe(join(resourcesDir, 'gamma-logos', variant.fileName))
    }
  })

  test('Given 旧配色、未知值或路径穿越输入 When 请求切换 Then 不应用图标也不保存偏好', () => {
    const runtime = createRuntime()
    for (const variantId of ['black', 'rose-gold', '../icon', '../../icon', '', null, undefined, 10, {}]) {
      expect(resolveAppIconPath(variantId, resourcesDir)).toBeNull()
      expect(setAppIconVariant(variantId, runtime.dependencies)).toBe(false)
    }
    expect(runtime.appliedPaths).toEqual([])
    expect(runtime.savedVariants).toEqual([])
    expect(runtime.getPersistedVariant()).toBe('default')
  })

  test('Given macOS 与完整资源 When 选择翡翠金 Then 更新 Dock 并持久化对应 ID', () => {
    const runtime = createRuntime()
    expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(true)
    expect(runtime.getDockIconPath()).toBe(emeraldPath)
    expect(runtime.getPersistedVariant()).toBe('emerald-gold')
    expect(runtime.savedVariants).toEqual(['emerald-gold'])
  })

  test('Given 已保存翡翠金 When 新进程恢复偏好 Then 使用翡翠金且不重复写盘', () => {
    const runtime = createRuntime('emerald-gold')
    expect(restoreAppIconVariant(runtime.dependencies)).toBe(true)
    expect(runtime.appliedPaths).toEqual([emeraldPath])
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given 旧配色或缺失偏好 When 重启恢复 Then 使用默认白底黑银', () => {
    for (const variantId of ['black', 'gradient', '../icon', undefined, null]) {
      const runtime = createRuntime(variantId)
      expect(restoreAppIconVariant(runtime.dependencies)).toBe(true)
      expect(runtime.appliedPaths).toEqual([defaultPath])
      expect(runtime.savedVariants).toEqual([])
    }
  })

  test('Given 选择的图标资源缺失 When 请求切换 Then 保持原状态且不写盘', () => {
    const runtime = createRuntime()
    runtime.availablePaths.delete(emeraldPath)
    expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(false)
    expect(runtime.appliedPaths).toEqual([])
    expect(runtime.getPersistedVariant()).toBe('default')
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given 已保存图标资源缺失 When 重启 Then 回退并保存默认款保持设置与 Dock 一致', () => {
    const runtime = createRuntime('emerald-gold')
    runtime.availablePaths.delete(emeraldPath)
    expect(restoreAppIconVariant(runtime.dependencies)).toBe(true)
    expect(runtime.appliedPaths).toEqual([defaultPath])
    expect(runtime.getPersistedVariant()).toBe('default')
    expect(runtime.savedVariants).toEqual(['default'])
  })

  test('Given 已保存图标及默认资源均缺失 When 重启 Then 不应用图标也不改写偏好', () => {
    const runtime = createRuntime('emerald-gold')
    runtime.availablePaths.delete(emeraldPath)
    runtime.availablePaths.delete(defaultPath)
    expect(restoreAppIconVariant(runtime.dependencies)).toBe(false)
    expect(runtime.appliedPaths).toEqual([])
    expect(runtime.getPersistedVariant()).toBe('emerald-gold')
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given 缺图恢复默认但写盘失败 When 重启 Then 报告失败且保留原磁盘偏好', () => {
    const runtime = createRuntime('emerald-gold')
    runtime.availablePaths.delete(emeraldPath)
    runtime.dependencies.saveVariant = () => { throw new Error('测试恢复偏好写盘失败') }
    expect(restoreAppIconVariant(runtime.dependencies)).toBe(false)
    expect(runtime.appliedPaths).toEqual([defaultPath])
    expect(runtime.getPersistedVariant()).toBe('emerald-gold')
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given 缺图恢复时 Dock 抛出异常 When 重启 Then 报告失败且不保存默认偏好', () => {
    const runtime = createRuntime('emerald-gold')
    runtime.availablePaths.delete(emeraldPath)
    runtime.dependencies.setDockIcon = () => { throw new Error('测试恢复 Dock 失败') }
    expect(restoreAppIconVariant(runtime.dependencies)).toBe(false)
    expect(runtime.savedVariants).toEqual([])
    expect(runtime.getPersistedVariant()).toBe('emerald-gold')
  })

  test('Given Windows、Linux 或没有 Dock API When 请求切换 Then 不返回成功且不写盘', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const runtime = createRuntime()
      runtime.dependencies.platform = platform
      expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(false)
      expect(restoreAppIconVariant(runtime.dependencies)).toBe(false)
      expect(runtime.appliedPaths).toEqual([])
      expect(runtime.savedVariants).toEqual([])
    }
    const runtime = createRuntime()
    runtime.dependencies.setDockIcon = undefined
    expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(false)
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given Dock 拒绝应用图标 When 请求切换 Then 保留原偏好', () => {
    const runtime = createRuntime()
    runtime.dependencies.setDockIcon = () => { throw new Error('测试 Dock 失败') }
    expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(false)
    expect(runtime.getDockIconPath()).toBe(defaultPath)
    expect(runtime.getPersistedVariant()).toBe('default')
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given 写盘失败 When 请求切换 Then 恢复原 Dock 图标且保留原偏好', () => {
    const runtime = createRuntime()
    runtime.dependencies.saveVariant = () => { throw new Error('测试写盘失败') }
    expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(false)
    expect(runtime.appliedPaths).toEqual([emeraldPath, defaultPath])
    expect(runtime.getDockIconPath()).toBe(defaultPath)
    expect(runtime.getPersistedVariant()).toBe('default')
    expect(runtime.savedVariants).toEqual([])
  })

  test('Given 所有可恢复资源缺失 When 切换或启动恢复 Then 不应用图标且不保存', () => {
    const runtime = createRuntime('black')
    runtime.availablePaths.delete(defaultPath)
    expect(setAppIconVariant('emerald-gold', runtime.dependencies)).toBe(false)
    expect(restoreAppIconVariant(runtime.dependencies)).toBe(false)
    expect(runtime.appliedPaths).toEqual([])
    expect(runtime.savedVariants).toEqual([])
  })
})
