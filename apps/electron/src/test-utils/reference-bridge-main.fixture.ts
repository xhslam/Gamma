/** 只准备合成资料；IPC、存储、orchestrator与Pi均使用生产实现。 */
import { BrowserWindow } from 'electron'
import { registerIpcHandlers } from '../main/ipc'
import { createChannel } from '../main/lib/channel-manager'
import { createAgentWorkspace } from '../main/lib/agent-workspace-manager'
import { appendSDKMessages, createAgentSession } from '../main/lib/agent-session-manager'
import { setMainWindow } from '../main/lib/main-window-store'

export async function initialize(baseUrl: string, projectRootPath: string): Promise<void> {
  const workspace = await createAgentWorkspace({ name: '桥接合成工作区', projectRootPath })
  const channel = createChannel({
    name: '仅本地合成Provider', provider: 'openai', baseUrl,
    apiKey: 'synthetic-local-provider-only', enabled: true,
    models: [{ id: 'gpt-4o-mini', name: '本地测试模型', enabled: true }],
  })
  const source = createAgentSession('桥接源资料7391', channel.id, workspace.id, 'gpt-4o-mini')
  appendSDKMessages(source.id, [
    { type: 'user', uuid: 'fixture-src-user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '合成资料暗号：桥接青花瓷7391。' }] } },
    { type: 'assistant', uuid: 'fixture-src-assistant', parent_tool_use_id: null, message: { role: 'assistant', stop_reason: 'stop', content: [{ type: 'text', text: '确认上述合成资料。' }] } },
  ])
  createAgentSession('桥接目标会话', channel.id, workspace.id, 'gpt-4o-mini')
  registerIpcHandlers()
}

export function bindMainWindow(window: BrowserWindow): void { setMainWindow(window) }
