import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { GITHUB_RELEASE_REPO } from '../github-release-client'
import { writeTextFileAtomic } from '../safe-file'

/**
 * electron-builder 的目录打包可能不生成 app-update.yml。检查和下载缓存都依赖它，
 * 因此不能只调用 setFeedURL；缺失时在用户目录生成完整配置，不改动已签名应用。
 * 已有打包配置始终优先，其解析/读取错误必须由更新器如实报告。
 */
export function resolveUpdateConfigPath(resourcesPath: string, userDataPath: string): string {
  const bundledPath = join(resourcesPath, 'app-update.yml')
  if (existsSync(bundledPath)) return bundledPath

  const fallbackPath = join(userDataPath, 'updater-fallback.yml')
  // 每次使用前重新生成受信任的发布源，不将用户目录里的旧回退文件视作配置输入。
  writeTextFileAtomic(fallbackPath, [
    'provider: github',
    `owner: ${GITHUB_RELEASE_REPO.owner}`,
    `repo: ${GITHUB_RELEASE_REPO.repo}`,
    'updaterCacheDirName: gamma-updater',
    '',
  ].join('\n'))
  return fallbackPath
}
