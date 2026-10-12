import { join } from 'node:path'
import type { ModelsStore, ModelsStoreEntry } from '@earendil-works/pi-ai'
import { getConfigDir } from '../config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file'

/** Codex 公共模型目录归 Gamma 管理，不读取或写入全局 ~/.pi 配置。 */
export class CodexModelStore implements ModelsStore {
  constructor(private readonly configuredPath?: string) {}

  private get path(): string {
    return this.configuredPath ?? join(getConfigDir(), 'codex-models.json')
  }

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    if (providerId !== 'openai-codex') return undefined
    const entry = readJsonFileSafe<ModelsStoreEntry>(this.path)
    if (!entry || !Array.isArray(entry.models)) return undefined
    if (!entry.models.every((model) => model && typeof model.id === 'string'
      && model.provider === 'openai-codex' && model.api === 'openai-codex-responses')) return undefined
    return entry
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    if (providerId === 'openai-codex') writeJsonFileAtomic(this.path, entry)
  }

  async delete(providerId: string): Promise<void> {
    if (providerId === 'openai-codex') writeJsonFileAtomic(this.path, { models: [] })
  }
}
