#!/usr/bin/env bun
/** 构建期准备固定快照；使用时直接读取随应用分发的资源，不下载或安装。 */
import { resolve } from 'node:path'
import { createDesignBundleService } from '../src/main/lib/design-bundle'
import type { DesignBundleDependencies, DesignBundleStatus } from '../src/main/lib/design-bundle'

export async function prepareDesignBundle(
  appDirectory: string,
  dependencies: Omit<DesignBundleDependencies, 'installRoot' | 'bundledRoot'> = {},
): Promise<DesignBundleStatus> {
  const service = createDesignBundleService({
    ...dependencies,
    installRoot: resolve(appDirectory, 'resources/design-bundle'),
  })
  const result = await service.installDesignBundle(true)
  if (!result.installed || !result.bundlePath) throw new Error('内置 design 资源准备失败')
  return result
}

if (import.meta.main) {
  const status = await prepareDesignBundle(resolve(import.meta.dir, '..'))
  console.log(`[prepare:design] 六类编辑器已准备：${status.revision}`)
}
