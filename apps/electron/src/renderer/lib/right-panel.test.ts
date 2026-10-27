import { describe, expect, it } from 'bun:test'
import {
  type OnDemandState,
  type OnDemandOverlayTab,
  transitionRightPanelState,
} from './right-panel-state'
import {
  formatBadgeNumber,
  calculateDiffBadgeStats,
} from './right-panel-badge'
import {
  detectShortcutCollision,
  validateShortcutDefinitions,
} from './right-panel-shortcuts'
import {
  migrateRightPanelOpenState,
  RIGHT_PANEL_MIGRATION_KEY,
} from './right-panel-migration'

describe('右侧按需面板 - 三状态流转与互斥 (S0 / S1 / S2)', () => {
  it('初始状态为 S0 (右侧收起，无浮层)', () => {
    const state: OnDemandState = {
      isBigPanelOpen: false,
      activeOverlay: null,
      activeTab: 'files',
    }
    expect(state.isBigPanelOpen).toBe(false)
    expect(state.activeOverlay).toBe(null)
  })

  it('点击图标进入 S1，原位展开对应浮层，大面板保持关闭', () => {
    const s0: OnDemandState = {
      isBigPanelOpen: false,
      activeOverlay: null,
      activeTab: 'files',
    }
    const s1 = transitionRightPanelState(s0, { type: 'TOGGLE_OVERLAY', tab: 'changes' })
    expect(s1.activeOverlay).toBe('changes')
    expect(s1.isBigPanelOpen).toBe(false)
  })

  it('再次点击同图标关闭 S1，返回 S0', () => {
    const s1: OnDemandState = {
      isBigPanelOpen: false,
      activeOverlay: 'changes',
      activeTab: 'files',
    }
    const next = transitionRightPanelState(s1, { type: 'TOGGLE_OVERLAY', tab: 'changes' })
    expect(next.activeOverlay).toBe(null)
    expect(next.isBigPanelOpen).toBe(false)
  })

  it('在 S1 点击不同图标，原位切换内容，不关闭浮层', () => {
    const s1: OnDemandState = {
      isBigPanelOpen: false,
      activeOverlay: 'files',
      activeTab: 'files',
    }
    const next = transitionRightPanelState(s1, { type: 'TOGGLE_OVERLAY', tab: 'changes' })
    expect(next.activeOverlay).toBe('changes')
    expect(next.isBigPanelOpen).toBe(false)
  })

  it('在 S1 点击条目触发 openInBigPanel，关闭 S1，进入 S2 大面板并切换对应标签', () => {
    const s1: OnDemandState = {
      isBigPanelOpen: false,
      activeOverlay: 'files',
      activeTab: 'files',
    }
    const s2 = transitionRightPanelState(s1, {
      type: 'OPEN_IN_BIG_PANEL',
      tab: 'changes',
      target: 'src/main.ts',
    })
    expect(s2.isBigPanelOpen).toBe(true)
    expect(s2.activeOverlay).toBe(null)
    expect(s2.activeTab).toBe('changes')
  })

  it('在 S2 点击收起按钮，回到 S0', () => {
    const s2: OnDemandState = {
      isBigPanelOpen: true,
      activeOverlay: null,
      activeTab: 'changes',
    }
    const s0 = transitionRightPanelState(s2, { type: 'COLLAPSE_BIG_PANEL' })
    expect(s0.isBigPanelOpen).toBe(false)
    expect(s0.activeOverlay).toBe(null)
  })

  it('在 S2 点击顶栏展开/切换或直接打开大面板，能恢复上次标签', () => {
    const s0: OnDemandState = {
      isBigPanelOpen: false,
      activeOverlay: null,
      activeTab: 'changes',
    }
    const s2 = transitionRightPanelState(s0, { type: 'EXPAND_BIG_PANEL' })
    expect(s2.isBigPanelOpen).toBe(true)
    expect(s2.activeTab).toBe('changes')
    expect(s2.activeOverlay).toBe(null)
  })

  it('S1 与 S2 严格互斥，若 S2 打开时触发 TOGGLE_OVERLAY，应关闭 S2 并仅开启 S1', () => {
    const s2: OnDemandState = {
      isBigPanelOpen: true,
      activeOverlay: null,
      activeTab: 'files',
    }
    const s1 = transitionRightPanelState(s2, { type: 'TOGGLE_OVERLAY', tab: 'files' })
    expect(s1.isBigPanelOpen).toBe(false)
    expect(s1.activeOverlay).toBe('files')
  })
})

describe('右侧按需面板 - 角标数字格式化与行级统计', () => {
  it('正确格式化小数值', () => {
    expect(formatBadgeNumber(0)).toBe('0')
    expect(formatBadgeNumber(1)).toBe('1')
    expect(formatBadgeNumber(42)).toBe('42')
    expect(formatBadgeNumber(999)).toBe('999')
  })

  it('正确格式化千级大数 (带 k)', () => {
    expect(formatBadgeNumber(1000)).toBe('1k')
    expect(formatBadgeNumber(1200)).toBe('1.2k')
    expect(formatBadgeNumber(1250)).toBe('1.3k')
    expect(formatBadgeNumber(9900)).toBe('9.9k')
    expect(formatBadgeNumber(10000)).toBe('10k')
  })

  it('正确格式化百万级大数 (带 M)', () => {
    expect(formatBadgeNumber(1000000)).toBe('1M')
    expect(formatBadgeNumber(1250000)).toBe('1.3M')
  })

  it('正确从 Git 变更结果计算行级统计与文件数', () => {
    const mockDiff = {
      isGitRepo: true,
      files: [
        { filePath: 'src/a.ts', status: 'modified' as const, additions: 10, deletions: 5, gitRoot: '/repo', source: 'workspace' as const },
        { filePath: 'src/b.ts', status: 'deleted' as const, additions: 0, deletions: 20, gitRoot: '/repo', source: 'workspace' as const },
      ],
      untrackedFiles: [
        { filePath: 'src/c.ts', additions: 15, deletions: 0, gitRoot: '/repo' },
      ],
      gitRootNames: ['repo'],
    }
    const stats = calculateDiffBadgeStats(mockDiff)
    expect(stats.hasChanges).toBe(true)
    expect(stats.totalFiles).toBe(3)
    expect(stats.additions).toBe(25)
    expect(stats.deletions).toBe(25)
  })

  it('空改动时返回 hasChanges 为 false', () => {
    const stats = calculateDiffBadgeStats({
      isGitRepo: true,
      files: [],
      untrackedFiles: [],
      gitRootNames: [],
    })
    expect(stats.hasChanges).toBe(false)
    expect(stats.totalFiles).toBe(0)
    expect(stats.additions).toBe(0)
    expect(stats.deletions).toBe(0)
  })
})

describe('右侧按需面板 - 快捷键冲突检测与验证', () => {
  it('能检测相同修饰键与按键的冲突', () => {
    const conflict = detectShortcutCollision('Cmd+Shift+E', 'Cmd+Shift+E', 'mac')
    expect(conflict).toBe(true)
  })

  it('修饰键别名也能被正确识别为冲突 (如 CmdOrCtrl 与 Cmd)', () => {
    const conflict = detectShortcutCollision('CmdOrCtrl+Shift+E', 'Cmd+Shift+E', 'mac')
    expect(conflict).toBe(true)
  })

  it('不同平台下的组合键区分', () => {
    // 在 Mac 下 Cmd+Shift+E 与 Ctrl+Shift+E 不冲突
    expect(detectShortcutCollision('Cmd+Shift+E', 'Ctrl+Shift+E', 'mac')).toBe(false)
    // 但若都解析为相同 modifier 则冲突
  })

  it('不能与保留快捷键冲突 (如 Cmd+1 到 Cmd+9)', () => {
    const reserved = detectShortcutCollision('Cmd+2', 'Cmd+2', 'mac')
    expect(reserved).toBe(true)
  })

  it('验证按需面板的 4 个默认快捷键互不冲突', () => {
    const defs = [
      { id: 'toggle-right-panel-files', defaultMac: 'Cmd+Shift+E', defaultWin: 'Ctrl+Alt+E' },
      { id: 'toggle-right-panel-changes', defaultMac: 'Cmd+Shift+G', defaultWin: 'Ctrl+Shift+G' },
      { id: 'toggle-right-panel-exploration', defaultMac: 'Cmd+Shift+J', defaultWin: 'Ctrl+Shift+J' },
      { id: 'toggle-right-panel', defaultMac: 'Cmd+Shift+B', defaultWin: 'Ctrl+Shift+B' },
    ]
    const macReport = validateShortcutDefinitions(defs, 'mac')
    expect(macReport.valid).toBe(true)
    expect(macReport.conflicts).toHaveLength(0)

    const winReport = validateShortcutDefinitions(defs, 'windows')
    expect(winReport.valid).toBe(true)
    expect(winReport.conflicts).toHaveLength(0)
  })
})

describe('右侧按需面板 - 一次性迁移旧展开为收起', () => {
  it('未迁移前，将旧的全局/会话打开状态重置为全收起并记录迁移标记', () => {
    const oldOpenMap: Record<string, boolean> = {
      'session-1': true,
      'session-2': true,
    }
    let storedFlag: string | null = null
    const storage = {
      getItem: (key: string) => (key === RIGHT_PANEL_MIGRATION_KEY ? storedFlag : null),
      setItem: (key: string, val: string) => {
        if (key === RIGHT_PANEL_MIGRATION_KEY) storedFlag = val
      },
    }

    const { openMap, migrated } = migrateRightPanelOpenState(oldOpenMap, storage)
    expect(migrated).toBe(true)
    expect(openMap).toEqual({})
    expect(String(storedFlag)).toBe('true')
  })

  it('已迁移后，保留用户后续的主动操作，不再覆盖', () => {
    const userOpenMap: Record<string, boolean> = {
      'session-1': true,
    }
    const storage = {
      getItem: (key: string) => (key === RIGHT_PANEL_MIGRATION_KEY ? 'true' : null),
      setItem: () => {},
    }

    const { openMap, migrated } = migrateRightPanelOpenState(userOpenMap, storage)
    expect(migrated).toBe(false)
    expect(openMap).toEqual({ 'session-1': true })
  })
})
