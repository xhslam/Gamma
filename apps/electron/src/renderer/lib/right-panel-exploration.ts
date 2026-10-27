/**
 * right-panel-exploration — 动态调研分支纯派生逻辑与契约
 *
 * 对齐 SidePanel 与 AgentHeader 的真实探索分支生命周期：
 * 1. 活跃调研条目仅来自 agentSideTemporaryAgentMapAtom，关闭后即消失
 * 2. Tooltip 展示真实当前条目标题，多个时展示数量与最近一条
 * 3. 历史分支恢复必须携带真实 sourceMessageId / sourceLabel，禁止捏造假元数据
 */

import type { AgentSessionMeta } from '@gamma/shared'
import type { AgentExplorationBranchTab } from '@/atoms/agent-atoms'

export interface ExplorationBranchItem {
  sessionId: string
  title: string
  sourceMessageId: string
  sourceLabel: string
  updatedAt: number
}

/**
 * 派生当前会话的有效活跃调研分支
 * 严格基于 sideTemporaryAgentMap 且在 sessions 中存在的条目
 */
export function deriveActiveExplorationBranches(
  sessionId: string,
  sideTemporaryAgentMap: Map<string, AgentExplorationBranchTab[]>,
  sessions: AgentSessionMeta[],
): ExplorationBranchItem[] {
  if (!sessionId) return []
  const activeTabs = sideTemporaryAgentMap.get(sessionId) ?? []
  if (activeTabs.length === 0) return []

  const sessionMap = new Map(sessions.map((s) => [s.id, s]))
  const results: ExplorationBranchItem[] = []

  for (const tab of activeTabs) {
    const sessionMeta = sessionMap.get(tab.sessionId)
    if (!sessionMeta) continue
    results.push({
      sessionId: tab.sessionId,
      title: sessionMeta.title || '探索分支',
      sourceMessageId: tab.sourceMessageId || sessionMeta.explorationSourceMessageId || '',
      sourceLabel: tab.sourceLabel || sessionMeta.explorationSourceLabel || '主线探索节点',
      updatedAt: sessionMeta.updatedAt || sessionMeta.createdAt || 0,
    })
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 派生历史可恢复调研分支（已持久化且包含分叉锚点消息 ID）
 */
export function deriveHistoricalExplorationBranches(
  sessionId: string,
  sessions: AgentSessionMeta[],
  activeBranchIds?: Set<string>,
): AgentSessionMeta[] {
  if (!sessionId) return []
  return sessions
    .filter((s) =>
      s.explorationParentSessionId === sessionId &&
      Boolean(s.explorationSourceMessageId) &&
      (!activeBranchIds || !activeBranchIds.has(s.id)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 生成符合规范的调研 Tooltip 文本：
 * - 0 项：调研分支
 * - 1 项：调研：{标题}
 * - 多项：调研分支 ({数量} 个，最近：{最近标题})
 */
export function getExplorationTooltip(
  activeBranches: ExplorationBranchItem[],
  shortcut?: string,
): string {
  const shortcutSuffix = shortcut ? ` (${shortcut})` : ''
  if (activeBranches.length === 0) {
    return `调研分支${shortcutSuffix}`
  }
  const firstTitle = activeBranches[0]?.title ?? '探索分支'
  if (activeBranches.length === 1) {
    return `调研：${firstTitle}${shortcutSuffix}`
  }
  return `调研分支 (${activeBranches.length} 个，最近：${firstTitle})${shortcutSuffix}`
}

/**
 * 校验历史分支是否具备恢复所需真实元数据
 */
export function canRestoreExplorationBranch(branch: AgentSessionMeta): boolean {
  return Boolean(branch.explorationSourceMessageId && branch.explorationSourceMessageId.trim().length > 0)
}

/**
 * 构建用于注入 sideTemporaryAgentMap 的恢复负载（包含真实 sourceMessageId 和 sourceLabel）
 */
export function buildExplorationRestorePayload(
  branch: AgentSessionMeta,
): AgentExplorationBranchTab | null {
  if (!canRestoreExplorationBranch(branch)) return null
  return {
    sessionId: branch.id,
    sourceMessageId: branch.explorationSourceMessageId!,
    sourceLabel: branch.explorationSourceLabel || '主线探索节点',
  }
}
