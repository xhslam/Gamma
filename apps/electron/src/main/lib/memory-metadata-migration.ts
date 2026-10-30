/**
 * 记忆元数据迁移工具
 *
 * 负责扫描 globalRoot 与 workspaceRoot 两个独立记忆根目录中的 Markdown 文件，
 * 补齐元数据（name、description、sources、aliases <= 8），保留原正文与未知 frontmatter 字段。
 *
 * 核心机制：
 * 1. 双根隔离（global vs workspace），绝不跨根穿透或串写
 * 2. 遍历跳过 symlink 与隐藏内部文件，避免目录穿透与循环
 * 3. CAS（Compare-And-Swap）版本比对与原子写入（writeTextFileAtomic）
 * 4. 敏感文件（健康、财务、身份等）不外发正文、description 仅保留主题
 * 5. 抽象 description 重写回调，未配置时输出 needsDescription 阻止 apply
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeTextFileAtomic, readJsonFileSafe } from './safe-file'
import { MemoryCatalog } from './memory-catalog'
import {
  parseMemoryDocument,
  patchMemoryMetadata,
  isGenericMemoryDescription,
  isSensitiveMemoryTopic,
  sensitiveMemoryDescription,
  type MemoryMetadata,
} from './memory-metadata'

export type MemoryScope = 'global' | 'workspace'

export interface MemoryMigrationRoot {
  scope: MemoryScope
  root: string
}

export interface MemoryRewriteContext {
  scope: MemoryScope
  path: string // 相对记忆根目录的路径，例如 "profile.md" 或 "topics/finance.md"
  fullPath: string
  filename: string
  existingDescription?: string
  isSensitive: boolean
  topicHint?: string
  contentSummary?: string
}

export type MemoryDescriptionRewriter = (context: MemoryRewriteContext) => Promise<string>

export interface MetadataFieldDiff<T> {
  from: T | undefined
  to: T
  changed: boolean
}

export interface MemoryMetadataDiff {
  name?: MetadataFieldDiff<string>
  description?: MetadataFieldDiff<string>
  sources?: MetadataFieldDiff<string[]>
  aliases?: MetadataFieldDiff<string[]>
  hasChanges: boolean
}

export interface MemoryMigrationPlanItem {
  scope: MemoryScope
  path: string
  fullPath: string
  currentVersion: string
  originalMetadata: Partial<MemoryMetadata>
  targetMetadata: MemoryMetadata
  diff: MemoryMetadataDiff
  needsDescription: boolean
  isSensitive: boolean
  status: 'up-to-date' | 'pending' | 'blocked'
  reason?: string
}

export interface MemoryMigrationPlanSummary {
  totalFiles: number
  upToDate: number
  pending: number
  blocked: number
  sensitiveFiles: number
  canApply: boolean
}

export interface MemoryMigrationPlan {
  version: 1
  createdAt: string
  roots: MemoryMigrationRoot[]
  items: MemoryMigrationPlanItem[]
  summary: MemoryMigrationPlanSummary
}

export interface BuildPlanOptions {
  roots: MemoryMigrationRoot[]
  rewriteDescription?: MemoryDescriptionRewriter
}

export interface ApplyPlanOptions {
  confirm: boolean
}

export interface MemoryMigrationItemResult {
  scope: MemoryScope
  path: string
  fullPath: string
  success: boolean
  error?: string
}

export interface MemoryMigrationApplyResult {
  success: boolean
  appliedCount: number
  failureCount: number
  results: MemoryMigrationItemResult[]
}

/**
 * 计算记忆文件内容的内容哈希（基于 SHA-256 全哈希，供 CAS 校验比对）
 */
export function computeMemoryContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * 安全比对两个字符串数组是否元素完全一致
 */
function stringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 安全扫描指定记忆根目录下的 Markdown 文件
 *
 * 严格规则：
 * 1. 忽略隐藏目录与文件（以 . 开头）
 * 2. 忽略任何符号链接（文件与目录），绝对无 symlink 穿透
 * 3. 递归安全遍历，仅收集普通 .md 文件
 */
export async function scanMarkdownFilesInRoot(rootDir: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootDir)
  const results: string[] = []

  try {
    const rootStat = await fs.lstat(resolvedRoot)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return []
    }
  } catch {
    return []
  }

  async function walk(currentDir: string): Promise<void> {
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    // 按文件名升序，保证在各平台产出顺序一致
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      // 忽略隐藏文件与目录
      if (entry.name.startsWith('.')) {
        continue
      }

      // 忽略符号链接
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)

      try {
        const stat = await fs.lstat(fullPath)
        if (stat.isSymbolicLink()) {
          continue
        }

        if (stat.isDirectory()) {
          await walk(fullPath)
        } else if (stat.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath)
        }
      } catch {
        continue
      }
    }
  }

  await walk(resolvedRoot)
  return results
}

/**
 * 从文件路径推导非敏感主题提示
 */
function deriveNonSensitiveTopicHint(relPath: string, filename: string): string {
  const stem = filename.endsWith('.md') ? filename.slice(0, -3) : filename
  const dir = path.dirname(relPath)
  if (dir && dir !== '.') {
    return `${dir.replace(/[/\\]+/g, '/')}: ${stem}`
  }
  return stem
}

/**
 * 提取非敏感正文简要主题摘要（不泄露敏感信息，仅用于一般文件提示）
 */
function extractNonSensitiveSummary(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('```') && !line.startsWith('---'))
  const snippet = lines.slice(0, 3).join(' ')
  return snippet.slice(0, 150)
}

/**
 * 单行化与截断 description 保证 <= 150 字符
 */
function sanitizeSingleLineDescription(desc: string): string {
  return desc.replace(/\r?\n+/g, ' ').trim().slice(0, 150)
}

/**
 * 构建记忆元数据迁移计划（纯内存与只读分析，零写入）
 *
 * 产出只含 frontmatter 差异的 diff + version 计划。
 * 敏感文件绝不将正文放入 diff 或计划中，避免 preview 泄露敏感信息。
 */
export async function buildMemoryMigrationPlan(options: BuildPlanOptions): Promise<MemoryMigrationPlan> {
  const items: MemoryMigrationPlanItem[] = []

  for (const rootInfo of options.roots) {
    const rootPath = path.resolve(rootInfo.root)
    const files = await scanMarkdownFilesInRoot(rootPath)

    for (const fullPath of files) {
      const relPath = path.relative(rootPath, fullPath).split(path.sep).join('/')
      const filename = path.basename(fullPath)

      let rawContent: string
      try {
        rawContent = await fs.readFile(fullPath, 'utf-8')
      } catch {
        continue
      }

      const currentVersion = computeMemoryContentHash(rawContent)
      const { metadata: origMeta, body } = parseMemoryDocument(rawContent)

      // 1. name: 补齐为 basename(含.md)
      const targetName = filename

      // 2. sources: 补齐为数组
      const targetSources = Array.isArray(origMeta.sources) ? [...origMeta.sources] : []

      // 3. aliases: 补齐为数组且最大长度 <= 8
      const targetAliases = Array.isArray(origMeta.aliases)
        ? origMeta.aliases.slice(0, 8)
        : []

      // 4. 敏感判断
      const isSensitive = isSensitiveMemoryTopic(relPath, origMeta.description || '', rawContent)

      // 5. description: 检查是否缺失或过于笼统
      let targetDescription = ''
      let needsDescription = false

      const isMissingDesc = !origMeta.description || origMeta.description.trim().length === 0
      const isGeneric = isMissingDesc || isGenericMemoryDescription(origMeta.description)

      if (isSensitive) {
        // 敏感描述由本地固定主题生成，旧 description 即使具体也不能泄漏；不调用 LLM。
        targetDescription = sensitiveMemoryDescription(relPath, origMeta.description, rawContent)
      } else if (!isGeneric) {
        // 正常非笼统 description 不重写
        targetDescription = sanitizeSingleLineDescription(origMeta.description)
        needsDescription = false
      } else {
        // 过于笼统或缺失 description
        if (options.rewriteDescription) {
          const context: MemoryRewriteContext = {
            scope: rootInfo.scope,
            path: relPath,
            fullPath,
            filename,
            existingDescription: origMeta.description,
            isSensitive,
            topicHint: deriveNonSensitiveTopicHint(relPath, filename),
            // 敏感健康/财务/身份文件严禁外发正文或摘要
            contentSummary: isSensitive ? undefined : extractNonSensitiveSummary(body),
          }

          try {
            const rewritten = await options.rewriteDescription(context)
            const sanitized = sanitizeSingleLineDescription(rewritten)
            if (sanitized.length > 0 && !isGenericMemoryDescription(sanitized)) {
              targetDescription = sanitized
              needsDescription = false
            } else {
              targetDescription = origMeta.description || ''
              needsDescription = true
            }
          } catch {
            targetDescription = origMeta.description || ''
            needsDescription = true
          }
        } else {
          // callback 未配置时输出 needsDescription 阻止 apply，不伪装成 LLM 改写成功
          targetDescription = origMeta.description || ''
          needsDescription = true
        }
      }

      const targetMetadata: MemoryMetadata = {
        name: targetName,
        description: targetDescription,
        sources: targetSources,
        aliases: targetAliases,
      }

      const nameDiff: MetadataFieldDiff<string> = {
        from: origMeta.name,
        to: targetName,
        changed: origMeta.name !== targetName,
      }

      const descDiff: MetadataFieldDiff<string> = {
        from: isSensitive ? '[敏感旧描述不在预览中展示]' : origMeta.description,
        to: targetDescription,
        changed: origMeta.description !== targetDescription,
      }

      const sourcesDiff: MetadataFieldDiff<string[]> = {
        from: origMeta.sources,
        to: targetSources,
        changed: !/^sources:/m.test(rawContent.slice(0, rawContent.length - body.length)) || !stringArraysEqual(origMeta.sources, targetSources),
      }

      const aliasesDiff: MetadataFieldDiff<string[]> = {
        from: origMeta.aliases,
        to: targetAliases,
        changed: !/^aliases:/m.test(rawContent.slice(0, rawContent.length - body.length)) || !stringArraysEqual(origMeta.aliases, targetAliases),
      }

      const hasChanges =
        nameDiff.changed || descDiff.changed || sourcesDiff.changed || aliasesDiff.changed

      let status: 'up-to-date' | 'pending' | 'blocked' = 'up-to-date'
      let reason: string | undefined

      if (needsDescription) {
        status = 'blocked'
        reason = '描述缺失或过于笼统，需要通过 LLM 重写或人工补全，阻止直接应用'
      } else if (hasChanges) {
        status = 'pending'
      } else {
        status = 'up-to-date'
      }

      items.push({
        scope: rootInfo.scope,
        path: relPath,
        fullPath,
        currentVersion,
        originalMetadata: isSensitive ? { ...origMeta, description: '[敏感旧描述不在预览中展示]' } : origMeta,
        targetMetadata,
        diff: {
          name: nameDiff,
          description: descDiff,
          sources: sourcesDiff,
          aliases: aliasesDiff,
          hasChanges,
        },
        needsDescription,
        isSensitive,
        status,
        reason,
      })
    }
  }

  const totalFiles = items.length
  const upToDate = items.filter((i) => i.status === 'up-to-date').length
  const pending = items.filter((i) => i.status === 'pending').length
  const blocked = items.filter((i) => i.status === 'blocked').length
  const sensitiveFiles = items.filter((i) => i.isSensitive).length
  const canApply = blocked === 0

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    roots: options.roots.map((r) => ({ scope: r.scope, root: path.resolve(r.root) })),
    items,
    summary: {
      totalFiles,
      upToDate,
      pending,
      blocked,
      sensitiveFiles,
      canApply,
    },
  }
}

/**
 * 执行应用记忆元数据迁移计划
 *
 * 必须明确传入 confirm: true；
 * 对每个文件执行 CAS 校验，使用 safe-file 的 writeTextFileAtomic 原子落盘，
 * 保留原正文字节与未知 frontmatter 字段，不得删除任何文件。
 */
export async function applyMemoryMigrationPlan(
  plan: MemoryMigrationPlan,
  options: ApplyPlanOptions,
): Promise<MemoryMigrationApplyResult> {
  if (!options || options.confirm !== true) {
    throw new Error('执行记忆元数据迁移必须明确指定 confirm: true')
  }

  const blocked = plan.items.filter(item => item.needsDescription || item.status === 'blocked').length
  if (blocked > 0) {
    throw new Error(`迁移计划包含 ${blocked} 个阻塞项（如未配置描述改写 callback），拒绝执行应用`)
  }

  let appliedCount = 0
  let failureCount = 0
  const results: MemoryMigrationItemResult[] = []

  for (const item of plan.items) {
    if (item.status !== 'pending') {
      continue
    }

    let currentContent: string
    try {
      const root = plan.roots.find(candidate => candidate.scope === item.scope)
      if (!root) throw new Error('迁移项作用域没有对应根目录')
      const catalog = new MemoryCatalog({ roots: [root] })
      const resolved = await catalog.resolveFile(`${item.scope}:/${item.path}`)
      if (resolved.absolute !== path.resolve(item.fullPath)) throw new Error('迁移项路径不在预览根内')
      if (!item.targetMetadata || item.targetMetadata.name !== path.basename(item.path)
        || isGenericMemoryDescription(item.targetMetadata.description)
        || !Array.isArray(item.targetMetadata.aliases) || item.targetMetadata.aliases.length > 8
        || !Array.isArray(item.targetMetadata.sources)) throw new Error('迁移元数据不符合文件规范')
      currentContent = await fs.readFile(resolved.absolute, 'utf-8')
    } catch (err) {
      failureCount++
      results.push({
        scope: item.scope,
        path: item.path,
        fullPath: item.fullPath,
        success: false,
        error: `无法读取原文件: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    // CAS 版本一致性比对
    const actualVersion = computeMemoryContentHash(currentContent)
    if (actualVersion !== item.currentVersion) {
      failureCount++
      results.push({
        scope: item.scope,
        path: item.path,
        fullPath: item.fullPath,
        success: false,
        error: `CAS 版本校验失败：文件已被外部修改 (预期版本: ${item.currentVersion}, 当前版本: ${actualVersion})`,
      })
      continue
    }

    try {
      const originalAliases = parseMemoryDocument(currentContent).metadata.aliases
      const patched = patchMemoryMetadata(currentContent, { ...item.targetMetadata,
        ...(originalAliases.length > 8 ? { aliases_overflow: originalAliases.slice(8) } : {}),
      })
      if (parseMemoryDocument(patched).body !== parseMemoryDocument(currentContent).body) throw new Error('正文无损校验失败，未写入')
      writeTextFileAtomic(item.fullPath, patched, 0o600)
      appliedCount++
      results.push({
        scope: item.scope,
        path: item.path,
        fullPath: item.fullPath,
        success: true,
      })
    } catch (err) {
      failureCount++
      results.push({
        scope: item.scope,
        path: item.path,
        fullPath: item.fullPath,
        success: false,
        error: `原子落盘失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return {
    success: failureCount === 0,
    appliedCount,
    failureCount,
    results,
  }
}

/**
 * 使用原子封装持久化迁移计划 JSON 文件
 */
export function saveMemoryMigrationPlan(planPath: string, plan: MemoryMigrationPlan): void {
  writeTextFileAtomic(planPath, JSON.stringify(plan, null, 2), 0o600)
}

/**
 * 安全读取已持久化的迁移计划 JSON 文件
 */
export function loadMemoryMigrationPlan(planPath: string): MemoryMigrationPlan {
  const plan = readJsonFileSafe<MemoryMigrationPlan>(planPath)
  if (!plan || plan.version !== 1 || !Array.isArray(plan.items) || !Array.isArray(plan.roots) || typeof plan.summary !== 'object') {
    throw new Error(`无效或损坏的记忆迁移计划文件: ${planPath}`)
  }
  return plan
}
