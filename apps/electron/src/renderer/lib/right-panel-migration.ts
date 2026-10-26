/**
 * 右侧面板一次性迁移逻辑
 *
 * 保证旧版本展开的用户在升级后默认收起 (S0)，随后记住用户的主动操作。
 * 新用户冷启动同样保持 S0。
 */

export const RIGHT_PANEL_MIGRATION_KEY = 'gamma-right-panel-migrated-v1'

export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface MigrationResult {
  openMap: Record<string, boolean>
  migrated: boolean
}

/**
 * 迁移右侧面板打开状态
 */
export function migrateRightPanelOpenState(
  existingOpenMap: Record<string, boolean>,
  storage: StorageLike = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} },
): MigrationResult {
  const isMigrated = storage.getItem(RIGHT_PANEL_MIGRATION_KEY) === 'true'

  if (isMigrated) {
    return {
      openMap: existingOpenMap,
      migrated: false,
    }
  }

  // 尚未迁移：重置为全收起，并记录迁移标记
  storage.setItem(RIGHT_PANEL_MIGRATION_KEY, 'true')

  return {
    openMap: {},
    migrated: true,
  }
}
