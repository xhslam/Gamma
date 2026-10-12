/** 应用图标只接受内置资源；动态切换目前由 macOS Dock 支持。 */
import { join } from 'node:path'
import { getAppIconResourcePath, isAppIconVariantId, normalizeAppIconVariant } from '../../types/app-icons'
import type { AppIconVariantId } from '../../types/app-icons'

export interface AppIconDependencies {
  platform: NodeJS.Platform
  resourcesDir: string
  fileExists: (path: string) => boolean
  setDockIcon?: (path: string) => void
  readVariant: () => unknown
  saveVariant: (variantId: AppIconVariantId) => void
}

/** 无效 ID 不解析为路径，避免 renderer 输入穿越内置资源目录。 */
export function resolveAppIconPath(variantId: unknown, resourcesDir: string): string | null {
  const resourcePath = getAppIconResourcePath(variantId)
  return resourcePath ? join(resourcesDir, resourcePath) : null
}

/** 已保存偏好缺图时仍使用默认款，保证升级后 Dock 图标可恢复。 */
function getRestorableIconPath(variantId: unknown, dependencies: Pick<AppIconDependencies, 'resourcesDir' | 'fileExists'>): string | null {
  const preferredPath = resolveAppIconPath(normalizeAppIconVariant(variantId), dependencies.resourcesDir)
  if (preferredPath && dependencies.fileExists(preferredPath)) return preferredPath
  const defaultPath = resolveAppIconPath('default', dependencies.resourcesDir)
  return defaultPath && dependencies.fileExists(defaultPath) ? defaultPath : null
}

/** 切换成功才保存偏好；保存失败则恢复原 Dock 图标。 */
export function setAppIconVariant(variantId: unknown, dependencies: AppIconDependencies): boolean {
  if (dependencies.platform !== 'darwin' || !dependencies.setDockIcon || !isAppIconVariantId(variantId)) {
    return false
  }

  let previousIconPath: string | null = null
  let applied = false
  try {
    const iconPath = resolveAppIconPath(variantId, dependencies.resourcesDir)
    if (!iconPath || !dependencies.fileExists(iconPath)) return false
    previousIconPath = getRestorableIconPath(dependencies.readVariant(), dependencies)
    // 无法恢复原状态时，不先应用一个可能无法持久化的临时图标。
    if (!previousIconPath) return false
    dependencies.setDockIcon(iconPath)
    applied = true
    dependencies.saveVariant(variantId)
    return true
  } catch (error) {
    if (applied && previousIconPath) {
      try {
        dependencies.setDockIcon(previousIconPath)
      } catch (restoreError) {
        console.error('[图标] 恢复原 Dock 图标失败:', restoreError)
      }
    }
    console.error('[图标] 切换失败:', error)
    return false
  }
}

/** 启动恢复缺图时保存实际使用的默认款，保证设置选中项与 Dock 一致。 */
export function restoreAppIconVariant(dependencies: AppIconDependencies): boolean {
  if (dependencies.platform !== 'darwin' || !dependencies.setDockIcon) return false
  try {
    const variantId = normalizeAppIconVariant(dependencies.readVariant())
    const iconPath = getRestorableIconPath(variantId, dependencies)
    if (!iconPath) return false
    dependencies.setDockIcon(iconPath)
    if (iconPath !== resolveAppIconPath(variantId, dependencies.resourcesDir)) {
      dependencies.saveVariant('default')
    }
    return true
  } catch (error) {
    console.error('[图标] 恢复 Dock 图标失败:', error)
    return false
  }
}
