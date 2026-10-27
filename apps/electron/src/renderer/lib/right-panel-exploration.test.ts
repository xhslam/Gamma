import { describe, expect, test } from 'bun:test'
import {
  deriveActiveExplorationBranches,
  deriveHistoricalExplorationBranches,
  getExplorationTooltip,
  canRestoreExplorationBranch,
  buildExplorationRestorePayload,
} from './right-panel-exploration'
import type { AgentSessionMeta } from '@gamma/shared'
import type { AgentExplorationBranchTab } from '@/atoms/agent-atoms'

describe('右侧按需面板 - 动态调研分支派生与元数据契约', () => {
  const sessionId = 'session-main'

  const mockSessions: AgentSessionMeta[] = [
    {
      id: sessionId,
      title: '主线会话',
      createdAt: 1000,
      updatedAt: 5000,
    },
    {
      id: 'branch-active-1',
      title: '调研分支 A',
      explorationParentSessionId: sessionId,
      explorationSourceMessageId: 'msg-anchor-1',
      explorationSourceLabel: '架构重构节点',
      createdAt: 2000,
      updatedAt: 6000,
    },
    {
      id: 'branch-active-2',
      title: '调研分支 B',
      explorationParentSessionId: sessionId,
      explorationSourceMessageId: 'msg-anchor-2',
      explorationSourceLabel: '性能优化节点',
      createdAt: 3000,
      updatedAt: 7000,
    },
    {
      id: 'branch-historical',
      title: '历史探索分支 C',
      explorationParentSessionId: sessionId,
      explorationSourceMessageId: 'msg-anchor-3',
      explorationSourceLabel: '历史探索节点',
      createdAt: 1500,
      updatedAt: 4000,
    },
    {
      id: 'branch-corrupted',
      title: '损坏分支 D (无锚点)',
      explorationParentSessionId: sessionId,
      createdAt: 1200,
      updatedAt: 3000,
    },
  ]

  test('deriveActiveExplorationBranches 严格对齐 sideTemporaryAgentMap 且过滤已删除会话', () => {
    // 1. 无活跃分支
    const emptyMap = new Map<string, AgentExplorationBranchTab[]>()
    expect(deriveActiveExplorationBranches(sessionId, emptyMap, mockSessions)).toEqual([])

    // 2. 存在活跃分支与悬空分支
    const activeMap = new Map<string, AgentExplorationBranchTab[]>([
      [
        sessionId,
        [
          { sessionId: 'branch-active-1', sourceMessageId: 'msg-anchor-1', sourceLabel: '架构重构节点' },
          { sessionId: 'branch-deleted-ghost', sourceMessageId: 'msg-ghost', sourceLabel: '已删除会话' },
        ],
      ],
    ])

    const active = deriveActiveExplorationBranches(sessionId, activeMap, mockSessions)
    expect(active.length).toBe(1)
    expect(active[0]?.sessionId).toBe('branch-active-1')
    expect(active[0]?.title).toBe('调研分支 A')
    expect(active[0]?.sourceMessageId).toBe('msg-anchor-1')
    expect(active[0]?.sourceLabel).toBe('架构重构节点')
  })

  test('deriveHistoricalExplorationBranches 正确识别历史分支并排除当前活跃分支', () => {
    const activeIds = new Set(['branch-active-1'])
    const historical = deriveHistoricalExplorationBranches(sessionId, mockSessions, activeIds)

    // 应包含 branch-active-2 和 branch-historical，排除当前活跃的 branch-active-1 与无锚点的 branch-corrupted
    expect(historical.some((h) => h.id === 'branch-active-1')).toBe(false)
    expect(historical.some((h) => h.id === 'branch-corrupted')).toBe(false)
    expect(historical.some((h) => h.id === 'branch-active-2')).toBe(true)
    expect(historical.some((h) => h.id === 'branch-historical')).toBe(true)
  })

  test('getExplorationTooltip 规范格式化：0 项、单项与多项', () => {
    expect(getExplorationTooltip([], 'Cmd+Shift+J')).toBe('调研分支 (Cmd+Shift+J)')

    const singleBranch = [
      {
        sessionId: 'branch-1',
        title: '状态机设计',
        sourceMessageId: 'msg-1',
        sourceLabel: '节点 1',
        updatedAt: 100,
      },
    ]
    expect(getExplorationTooltip(singleBranch, 'Cmd+Shift+J')).toBe('调研：状态机设计 (Cmd+Shift+J)')

    const multiBranches = [
      {
        sessionId: 'branch-2',
        title: '性能调优',
        sourceMessageId: 'msg-2',
        sourceLabel: '节点 2',
        updatedAt: 200,
      },
      ...singleBranch,
    ]
    expect(getExplorationTooltip(multiBranches, 'Cmd+Shift+J')).toBe(
      '调研分支 (2 个，最近：性能调优) (Cmd+Shift+J)',
    )
  })

  test('历史分支可恢复性校验与真实 Payload 构建', () => {
    const validBranch = mockSessions.find((s) => s.id === 'branch-historical')!
    const corruptBranch = mockSessions.find((s) => s.id === 'branch-corrupted')!

    expect(canRestoreExplorationBranch(validBranch)).toBe(true)
    expect(canRestoreExplorationBranch(corruptBranch)).toBe(false)

    const payload = buildExplorationRestorePayload(validBranch)
    expect(payload).toEqual({
      sessionId: 'branch-historical',
      sourceMessageId: 'msg-anchor-3',
      sourceLabel: '历史探索节点',
    })

    expect(buildExplorationRestorePayload(corruptBranch)).toBe(null)
  })
})
