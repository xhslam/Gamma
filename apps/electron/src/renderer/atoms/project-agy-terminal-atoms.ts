import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { ProjectAgyTerminalState } from '@gamma/shared'

export interface ProjectAgyTerminalEntry {
  accepted: boolean
  status: 'idle' | 'starting' | 'ready' | 'closed' | 'error'
  terminal?: ProjectAgyTerminalState
  error?: string
  requestId?: string
}

/** 仅标记说明条是否展示过，不保存或改变 AGY 的权限确认状态。 */
export const agyPermissionNoticeSeenAtom = atomWithStorage('gamma-agy-permission-notice-seen-v1', false, undefined, { getOnInit: true })

/** 仅保存本次 App 生命周期内的项目交互实例，绝不混入 Agent 会话终端。 */
export const projectAgyTerminalsAtom = atom(new Map<string, ProjectAgyTerminalEntry>())

export const openProjectAgyTerminalAtom = atom(null, async (get, set, input: { workspaceId: string; confirm?: boolean }) => {
  const current = get(projectAgyTerminalsAtom).get(input.workspaceId)
  if ((!current?.accepted && !input.confirm) || current?.status === 'starting') return
  const requestId = crypto.randomUUID()
  set(projectAgyTerminalsAtom, new Map(get(projectAgyTerminalsAtom)).set(input.workspaceId, {
    ...current, accepted: true, status: 'starting', error: undefined, requestId,
  }))
  try {
    const terminal = await window.electronAPI.openProjectAgyTerminal({ workspaceId: input.workspaceId, skipPermissionsConfirmed: true })
    if (get(projectAgyTerminalsAtom).get(input.workspaceId)?.requestId !== requestId) {
      await window.electronAPI.killTerminal(terminal.terminalId)
      return
    }
    set(projectAgyTerminalsAtom, new Map(get(projectAgyTerminalsAtom)).set(input.workspaceId, { accepted: true, status: 'ready', terminal }))
    // CLI 可能在 open 响应到达前就退出；当时还没有 terminalId，订阅无法归属该事件。
    // 登记后补取快照只合并明确的退出状态，不得用旧的 running 快照覆盖新 exit 事件。
    try {
      const snapshot = await window.electronAPI.getTerminalSnapshot(terminal.terminalId)
      const latest = get(projectAgyTerminalsAtom).get(input.workspaceId)
      if (snapshot.exitCode !== undefined && latest?.terminal?.terminalId === terminal.terminalId && latest.terminal.exitCode === undefined) {
        set(projectAgyTerminalsAtom, new Map(get(projectAgyTerminalsAtom)).set(input.workspaceId, {
          ...latest, terminal: { ...latest.terminal, exitCode: snapshot.exitCode },
        }))
      }
    } catch {
      // 并发关闭/项目删除会使快照失效；由终端视图报告恢复错误，绝不隐式重启。
    }
  } catch (error) {
    if (get(projectAgyTerminalsAtom).get(input.workspaceId)?.requestId !== requestId) return
    set(projectAgyTerminalsAtom, new Map(get(projectAgyTerminalsAtom)).set(input.workspaceId, {
      ...get(projectAgyTerminalsAtom).get(input.workspaceId),
      accepted: true, status: 'error', error: error instanceof Error ? error.message : String(error),
    }))
  }
})

export const closeProjectAgyTerminalAtom = atom(null, async (get, set, workspaceId: string) => {
  const current = get(projectAgyTerminalsAtom).get(workspaceId)
  // 启动期间不提供关闭按钮；待返回 terminalId 后才能可靠关闭。
  if (!current?.terminal || current.status === 'starting') return
  try {
    await window.electronAPI.killTerminal(current.terminal.terminalId)
    set(projectAgyTerminalsAtom, new Map(get(projectAgyTerminalsAtom)).set(workspaceId, { accepted: current.accepted, status: 'closed' }))
  } catch (error) {
    set(projectAgyTerminalsAtom, new Map(get(projectAgyTerminalsAtom)).set(workspaceId, {
      ...current, error: `关闭失败：${error instanceof Error ? error.message : String(error)}`,
    }))
  }
})
