import { collectLegacyCredentialSlots, reencryptLegacyCredentialSlots } from './legacy-brand-migration'
import type { PreparedLegacyBrandMigration } from './legacy-brand-migration'
import type { LegacyCookieProfile, LegacyHelperClient } from './legacy-credential-helper'
import { assertLegacyCookiesComplete, readLegacyCookieInventory } from './legacy-cookie-inventory'
import type { LegacyCookieInventory } from './legacy-cookie-inventory'

export interface BrandMigrationServices {
  identities: readonly string[]
  startHelper(identity: string, snapshot?: string): Promise<LegacyHelperClient>
  encryptionAvailable(): boolean
  encrypt(value: string): Buffer
  importCookies(profiles: readonly LegacyCookieProfile[]): Promise<void>
  readCookieInventory?(snapshot: string): LegacyCookieInventory
}

/** 所有凭据成功重新加密、Cookie 落盘后，才发布配置并允许加载业务模块。 */
export async function completeBrandMigration(prepared: PreparedLegacyBrandMigration, services: BrandMigrationServices): Promise<void> {
  let helper: LegacyHelperClient | undefined
  try {
    const slots = prepared.stagingConfigDirectory ? collectLegacyCredentialSlots(prepared.stagingConfigDirectory) : []
    if (prepared.profileNeedsMigration && !prepared.legacyProfileSnapshot) throw new Error('缺少旧浏览器只读快照，迁移已停止。')
    const inventory = prepared.profileNeedsMigration ? (services.readCookieInventory ?? readLegacyCookieInventory)(prepared.legacyProfileSnapshot!) : undefined
    if (slots.length > 0 && !services.encryptionAvailable()) throw new Error('系统凭据加密暂不可用，迁移已停止；请解锁系统钥匙串后重新启动 Gamma。旧数据已保留。')
    let plaintexts: string[] | undefined
    let cookies: LegacyCookieProfile[] | undefined
    let lastFailure: unknown
    if (slots.length > 0 || prepared.profileNeedsMigration) {
      for (const identity of services.identities) {
        let candidate: LegacyHelperClient | undefined
        try {
          candidate = await services.startHelper(identity, prepared.legacyProfileSnapshot)
          const values = await candidate.decrypt(slots.map((slot) => slot.ciphertext))
          if (values.every((value): value is string => value !== null)) {
            const exported = inventory ? await candidate.getCookies() : undefined
            if (inventory && exported) assertLegacyCookiesComplete(inventory, exported)
            helper = candidate
            plaintexts = values
            cookies = exported
            break
          }
        } catch (error) { lastFailure = error }
        finally { if (candidate && helper !== candidate) await candidate.stop() }
      }
      if (!helper) throw new Error(lastFailure instanceof Error ? lastFailure.message : '旧凭据无法读取，迁移已停止。旧目录仍保留，请检查系统钥匙串权限后重新启动 Gamma。')
    }
    if (cookies) await services.importCookies(cookies)
    if (slots.length > 0 && plaintexts) reencryptLegacyCredentialSlots(slots, plaintexts, services.encrypt)
    prepared.commit()
  } finally {
    try { await helper?.stop() } finally { prepared.dispose() }
  }
}
