#!/usr/bin/env bun
/** 使用跨平台文件 API 复制资源，复制失败时中止构建，避免产出缺失资源的安装包。 */
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export function buildResources(appDirectory: string): void {
  const source = resolve(appDirectory, 'resources')
  const destination = resolve(appDirectory, 'dist/resources')
  mkdirSync(resolve(appDirectory, 'dist'), { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
}

if (import.meta.main) {
  buildResources(resolve(import.meta.dir, '..'))
  console.log('[build:resources] 资源复制完成')
}
