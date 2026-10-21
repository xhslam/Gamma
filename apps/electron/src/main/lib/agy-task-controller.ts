import { AGY_IPC_CHANNELS } from '@gamma/shared'
import { getAgentSessionMeta, resolveAgentWorkbenchDir } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getMainWindow } from './main-window-store'
import { AgyTaskService } from './agy-task-service'

/** 服务始终在主进程持有；runtime 只能经已包装的工具请求，不直接生成外部会话。 */
export const agyTaskService = new AgyTaskService({
  context(sessionId) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)) throw new Error('无效会话 ID')
    const session = getAgentSessionMeta(sessionId)
    const workspace = session?.workspaceId ? getAgentWorkspace(session.workspaceId) : undefined
    const workbench = resolveAgentWorkbenchDir(workspace, sessionId)
    if (!session || !workspace || !workbench) throw new Error('外部任务需要有效工作区会话')
    // 真实任务启动时允许目录由工具捕获的会话授权上下文进一步限定；renderer 无启动接口。
    return { workbench, allowedRoots: [workbench] }
  },
  notify(update) {
    const window = getMainWindow()
    if (window && !window.webContents.isDestroyed()) window.webContents.send(AGY_IPC_CHANNELS.UPDATE, update)
  },
})
