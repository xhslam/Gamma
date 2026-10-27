/**
 * 右侧面板角标统计与数字格式化
 *
 * 处理文件改动行级增删统计、等宽数字小字号和大数紧凑展示 (如 1.2k)。
 * 支持非 Git 模式降级（无行级增删数据时按文件数展示角标）。
 */

import type { UnstagedChangesResult } from '@gamma/shared'
import type { SessionFileChange } from '@/lib/session-file-changes'

export interface DiffBadgeStats {
  hasChanges: boolean
  totalFiles: number
  additions: number
  deletions: number
}

/**
 * 格式化紧凑角标数字 (例如 1200 -> 1.2k, 1000000 -> 1M)
 */
export function formatBadgeNumber(num: number): string {
  if (num < 0) return '0'
  if (num < 1000) return String(num)

  if (num < 1_000_000) {
    const thousands = num / 1000
    const formatted = thousands >= 10
      ? String(Math.floor(thousands))
      : thousands.toFixed(1).replace(/\.0$/, '')
    return `${formatted}k`
  }

  const millions = num / 1_000_000
  const formatted = millions >= 10
    ? String(Math.floor(millions))
    : millions.toFixed(1).replace(/\.0$/, '')
  return `${formatted}M`
}

/**
 * 从 Git 未暂存结果或非 Git 改动计算角标统计
 */
export function calculateDiffBadgeStats(
  diffResult: UnstagedChangesResult | null | undefined,
  nonGitChanges?: SessionFileChange[] | null,
): DiffBadgeStats {
  // 非 Git 仓库或显式提供非 Git 文件变更：按修改文件数降级
  if (diffResult?.isGitRepo === false || (!diffResult && nonGitChanges && nonGitChanges.length > 0)) {
    const totalFiles = nonGitChanges?.length ?? 0
    return {
      hasChanges: totalFiles > 0,
      totalFiles,
      additions: 0,
      deletions: 0,
    }
  }

  if (!diffResult) {
    return {
      hasChanges: false,
      totalFiles: 0,
      additions: 0,
      deletions: 0,
    }
  }

  const trackedFiles = diffResult.files ?? []
  const untrackedFiles = diffResult.untrackedFiles ?? []

  let additions = 0
  let deletions = 0

  for (const file of trackedFiles) {
    additions += file.additions || 0
    deletions += file.deletions || 0
  }

  for (const file of untrackedFiles) {
    additions += file.additions || 0
  }

  const totalFiles = trackedFiles.length + untrackedFiles.length
  const hasChanges = totalFiles > 0

  return {
    hasChanges,
    totalFiles,
    additions,
    deletions,
  }
}
