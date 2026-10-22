import { randomUUID } from 'node:crypto'
import type { ProjectAgyTerminalInput, ProjectAgyTerminalState, TerminalCreateInput, TerminalSnapshot, TerminalState } from '@gamma/shared'

interface ProjectAgyTerminalDependencies {
  resolveCwd(workspaceId: string): string
  create(input: TerminalCreateInput): Promise<TerminalState>
  snapshot(terminalId: string): TerminalSnapshot
  kill(terminalId: string): void
}
interface ProjectTerminalEntry {
  terminalId: string
  cwd: string
  creation: Promise<ProjectAgyTerminalState>
}

/** 用户直接操作的项目终端，与 Agent/子 Agent 会话及权限配置完全独立。 */
export class ProjectAgyTerminalService {
  private readonly entries = new Map<string, ProjectTerminalEntry>()

  constructor(private readonly dependencies: ProjectAgyTerminalDependencies) {}

  async open(input: ProjectAgyTerminalInput): Promise<ProjectAgyTerminalState> {
    if (input?.skipPermissionsConfirmed !== true) throw new Error('请先确认 AGY 跳过全部工具权限检查的风险')
    if (typeof input.workspaceId !== 'string' || !input.workspaceId) throw new Error('请选择项目')
    // 每次重新核验项目，失效目录不能回退到 home 或旧路径。
    const cwd = this.dependencies.resolveCwd(input.workspaceId)
    const existing = this.entries.get(input.workspaceId)
    if (existing?.cwd === cwd) {
      const state = await existing.creation
      try {
        const snapshot = this.dependencies.snapshot(state.terminalId)
        return { ...state, ...(snapshot.exitCode === undefined ? {} : { exitCode: snapshot.exitCode }) }
      } catch {
        // 显式关闭后的首次点击才重建；CLI 自行退出仍保留最终屏幕。
        if (this.entries.get(input.workspaceId) !== existing) throw new Error('项目 AGY 终端已关闭，请重试')
        this.entries.delete(input.workspaceId)
      }
    } else if (existing) {
      this.close(input.workspaceId)
    }
    const terminalId = randomUUID()
    const ownerId = `project-agy:${input.workspaceId}`
    const entry: ProjectTerminalEntry = {
      terminalId,
      cwd,
      creation: this.dependencies.create({ terminalId, sessionId: ownerId, cwd, cols: 100, rows: 30 })
        .then((state) => {
          if (this.entries.get(input.workspaceId) !== entry) {
            this.dependencies.kill(terminalId)
            throw new Error('项目 AGY 终端已在启动期间关闭')
          }
          const snapshot = this.dependencies.snapshot(terminalId)
          return { ...state, workspaceId: input.workspaceId, ownerId, ...(snapshot.exitCode === undefined ? {} : { exitCode: snapshot.exitCode }) }
        }).catch((error: unknown) => {
          this.dependencies.kill(terminalId)
          if (this.entries.get(input.workspaceId) === entry) this.entries.delete(input.workspaceId)
          throw error
        }),
    }
    this.entries.set(input.workspaceId, entry)
    return entry.creation
  }

  close(workspaceId: string): void {
    const entry = this.entries.get(workspaceId)
    if (!entry) return
    this.entries.delete(workspaceId)
    this.dependencies.kill(entry.terminalId)
  }
}
