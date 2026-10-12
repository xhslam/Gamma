/** 改名前的缓存按键迁移；必须先于主题与 Jotai atom 模块初始化执行。 */
export interface LegacyStorageMigrationTarget {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function migrateLegacyRendererStorage(storage: LegacyStorageMigrationTarget): void {
  // 先保存原有键，避免 setItem 改变 length 或枚举顺序后漏迁移。
  const legacyKeys: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith('proma-')) legacyKeys.push(key)
    }
  } catch {
    return
  }

  for (const legacyKey of legacyKeys) {
    try {
      const currentKey = `gamma-${legacyKey.slice('proma-'.length)}`
      if (storage.getItem(currentKey) !== null) continue
      const value = storage.getItem(legacyKey)
      if (value !== null) storage.setItem(currentKey, value)
    } catch {
      // 存储禁用或配额不足时保留旧值，其他键仍可独立恢复。
    }
  }
}

if (typeof window !== 'undefined') {
  try {
    migrateLegacyRendererStorage(window.localStorage)
  } catch {
    // 获取 localStorage 本身也可能被浏览器策略拒绝，不阻止应用启动。
  }
}
